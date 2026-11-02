"""Voice enrollment. A voiceprint is biometric data: made only from audio the person records
themselves, with an explicit consent flag, stored encrypted, deletable, never returned."""

from __future__ import annotations

import io
import wave
from typing import Annotated

from fastapi import APIRouter, File, Form, HTTPException, UploadFile, status
from pydantic import BaseModel

from app.auth import CurrentUser
from app.providers.speaker_id import SpeakerIdUnavailable
from app.services import services
from app.voiceprints import seal

router = APIRouter()

MIN_S, MAX_S = 10, 90


class SpeakerOut(BaseModel):
    id: str
    display_name: str
    project_id: str | None
    consent_at: float


def _pcm(raw: bytes) -> bytes:
    try:
        with wave.open(io.BytesIO(raw)) as w:
            if (w.getframerate(), w.getnchannels(), w.getsampwidth()) != (16_000, 1, 2):
                raise HTTPException(
                    status.HTTP_422_UNPROCESSABLE_CONTENT, "Audio must be 16 kHz mono 16-bit WAV"
                )
            pcm = w.readframes(w.getnframes())
    except (wave.Error, EOFError) as e:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, f"Not a WAV file: {e}") from e
    seconds = len(pcm) / 32_000
    if not MIN_S <= seconds <= MAX_S:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_CONTENT,
            f"Record {MIN_S}–{MAX_S} seconds (got {seconds:.0f})",
        )
    return pcm


@router.post("/speakers/enroll", response_model=SpeakerOut, status_code=status.HTTP_201_CREATED)
async def enroll(
    user: CurrentUser,
    audio: Annotated[UploadFile, File(description="10-90 s of 16 kHz mono 16-bit WAV")],
    consent: Annotated[bool, Form(description="Must be true: the person agrees to a voiceprint")],
    display_name: Annotated[str, Form(min_length=1, max_length=100)],
    project_id: Annotated[str | None, Form()] = None,
) -> SpeakerOut:
    if consent is not True:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "A voiceprint needs your explicit consent")
    pcm = _pcm(await audio.read(MAX_S * 32_000 + 1024))
    s = services()
    try:
        vector, _model = await s.speaker_id.embed(pcm)
    except SpeakerIdUnavailable as e:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, str(e)) from e
    row = await s.speakers.enroll(
        user.user_id, project_id or None, display_name.strip(), seal(vector)
    )
    # The recording itself is not kept: only the encrypted voiceprint.
    return SpeakerOut(
        id=row.id,
        display_name=row.display_name,
        project_id=row.project_id,
        consent_at=row.consent_at,
    )


@router.get("/speakers", response_model=list[SpeakerOut])
async def my_speakers(user: CurrentUser) -> list[SpeakerOut]:
    return [
        SpeakerOut(
            id=r.id, display_name=r.display_name, project_id=r.project_id, consent_at=r.consent_at
        )
        for r in await services().speakers.mine(user.user_id)
    ]


@router.delete("/speakers/{speaker_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_speaker(speaker_id: str, user: CurrentUser) -> None:
    if not await services().speakers.delete(speaker_id, user.user_id):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Voiceprint not found")
