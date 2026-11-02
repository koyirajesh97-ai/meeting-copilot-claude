"""WebSocket /ws/meetings/{id}?token=…&last_seq=…

Up: binary audio frames (byte 0 = channel) and JSON client messages (control, ping).
Down: JSON events with increasing seq. On reconnect, pass last_seq to get what was missed.
"""

from __future__ import annotations

import asyncio
import contextlib
import logging
from typing import Any

from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from pydantic import ValidationError

from app.auth import InvalidToken, verify_token
from app.events import Control, Error, parse_client_message
from app.services import services

log = logging.getLogger("app.ws")
router = APIRouter()

#: Close codes (4000-4999 are for applications).
UNAUTHORIZED = 4401
NOT_FOUND = 4404
ENDED = 4409
#: Events queued for one slow client before it's disconnected (it can reconnect and replay).
MAX_QUEUE = 5000


@router.websocket("/ws/meetings/{meeting_id}")
async def meeting_socket(
    websocket: WebSocket, meeting_id: str, token: str = "", last_seq: int = 0
) -> None:
    await websocket.accept()
    try:
        principal = verify_token(token, scope="ws", meeting_id=meeting_id)
    except InvalidToken as e:
        await websocket.close(UNAUTHORIZED, f"invalid token: {e}"[:120])
        return
    s = services()
    meeting = await s.meetings.get(meeting_id)
    if meeting is None or meeting.owner_id != principal.user_id:
        await websocket.close(NOT_FOUND, "meeting not found")
        return
    if meeting.ended_at is not None:
        await websocket.close(ENDED, "meeting has ended")
        return

    queue: asyncio.Queue[dict[str, Any] | None] = asyncio.Queue()

    def peer(event: dict[str, Any]) -> None:
        if queue.qsize() >= MAX_QUEUE:
            queue.put_nowait(None)  # too far behind: drop the socket; the client will replay
        else:
            queue.put_nowait(event)

    async def writer() -> None:
        while (event := await queue.get()) is not None:
            await websocket.send_json(event)
        await websocket.close(1013, "client too slow; reconnect with last_seq")

    session = await s.sessions.open(meeting)
    replayed = await session.attach(peer, last_seq)
    if replayed:
        log.info("meeting %s: replayed %d events after seq %d", meeting_id, replayed, last_seq)
    send_task = asyncio.create_task(writer())
    try:
        while True:
            msg = await websocket.receive()
            if msg["type"] == "websocket.disconnect":
                break
            if msg.get("bytes") is not None:
                try:
                    await session.on_audio(msg["bytes"])
                except ValueError as e:
                    await session.emit(
                        Error,
                        code="bad_audio_frame",
                        message=str(e),
                        retryable=False,
                        store=False,
                        only=peer,
                    )
            elif msg.get("text") is not None:
                try:
                    cm = parse_client_message(msg["text"])
                except ValidationError as e:
                    await session.emit(
                        Error,
                        code="bad_message",
                        message=str(e.errors()[0]["msg"]),
                        retryable=False,
                        store=False,
                        only=peer,
                    )
                    continue
                if isinstance(cm, Control):
                    await session.on_control(cm, peer)
                # Ping: nothing to do; receiving it is the keep-alive.
    except WebSocketDisconnect:
        pass
    finally:
        session.detach(peer)
        send_task.cancel()
        with contextlib.suppress(asyncio.CancelledError, Exception):
            await send_task
        s.sessions.released(meeting_id)


#: What project members watching a shared meeting may see. Cards, detected questions and quota
#: notices are private to the person recording.
WATCH_TYPES = frozenset(
    {
        "meeting.started",
        "transcript.partial",
        "transcript.final",
        "speaker.identified",
        "summary.ready",
        "provider.switched",
    }
)


@router.websocket("/ws/meetings/{meeting_id}/watch")
async def watch_socket(
    websocket: WebSocket, meeting_id: str, token: str = "", last_seq: int = 0
) -> None:
    """Read-only live view for project members: captions and the summary notice, nothing private."""
    from app.api.meetings import can_read

    await websocket.accept()
    try:
        principal = verify_token(token, scope="watch", meeting_id=meeting_id)
    except InvalidToken as e:
        await websocket.close(UNAUTHORIZED, f"invalid token: {e}"[:120])
        return
    s = services()
    meeting = await s.meetings.get(meeting_id)
    if meeting is None or not await can_read(meeting, principal.user_id):
        await websocket.close(NOT_FOUND, "meeting not found")
        return
    session = s.sessions.get_any(meeting_id)
    if session is None:
        await websocket.close(ENDED, "meeting isn't live")
        return
    queue: asyncio.Queue[dict[str, Any] | None] = asyncio.Queue()

    def peer(event: dict[str, Any]) -> None:
        if event.get("type") not in WATCH_TYPES:
            return
        queue.put_nowait(None if queue.qsize() >= MAX_QUEUE else event)

    async def writer() -> None:
        while (event := await queue.get()) is not None:
            await websocket.send_json(event)
        await websocket.close(1013, "client too slow; reconnect with last_seq")

    await session.attach(peer, last_seq)
    send_task = asyncio.create_task(writer())
    try:
        while True:
            msg = await websocket.receive()
            if msg["type"] == "websocket.disconnect":
                break
            # Watchers can't send audio or controls; pings are fine and need no reply.
    except WebSocketDisconnect:
        pass
    finally:
        session.detach(peer)
        send_task.cancel()
        with contextlib.suppress(asyncio.CancelledError, Exception):
            await send_task
