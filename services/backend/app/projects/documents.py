"""Project knowledge: uploaded files and links, chunked and embedded so answer cards and
"Ask my meetings" can ground on them. Readable by project members only."""

from __future__ import annotations

import html
import io
import os
import re
import time
import uuid
from dataclasses import dataclass, field
from pathlib import Path

import httpx

from app.search.chunking import CHARS_PER_TOKEN, CHUNK_TOKENS, OVERLAP_TOKENS, Chunk

MAX_BYTES = 5 * 1024 * 1024
TEXT_TYPES = {".txt", ".md", ".markdown", ".csv", ".json", ".yaml", ".yml", ".log"}


class DocumentError(ValueError):
    pass


@dataclass
class Document:
    id: str
    project_id: str
    title: str
    uploaded_by: str
    source_url: str | None = None
    storage_path: str | None = None
    created_at: float = field(default_factory=time.time)


def new_document_id() -> str:
    return str(uuid.uuid4())


def html_to_text(raw: str) -> str:
    raw = re.sub(r"(?is)<(script|style|noscript)[^>]*>.*?</\1>", " ", raw)
    raw = re.sub(r"(?i)<br\s*/?>|</(p|div|li|h[1-6]|tr)>", "\n", raw)
    text = html.unescape(re.sub(r"<[^>]+>", " ", raw))
    return "\n".join(" ".join(line.split()) for line in text.splitlines() if line.strip())


def extract_text(filename: str, data: bytes) -> str:
    ext = Path(filename).suffix.lower()
    if len(data) > MAX_BYTES:
        raise DocumentError("Files up to 5 MB")
    if ext in TEXT_TYPES:
        return data.decode("utf-8", errors="replace")
    if ext in {".html", ".htm"}:
        return html_to_text(data.decode("utf-8", errors="replace"))
    if ext == ".pdf":
        try:
            from pypdf import PdfReader  # optional: uv sync --extra documents
        except ImportError as e:
            raise DocumentError("PDF support needs the `documents` extra (pypdf)") from e
        return "\n".join(p.extract_text() or "" for p in PdfReader(io.BytesIO(data)).pages)
    raise DocumentError(f"Unsupported file type {ext or '(none)'}: use text, Markdown, HTML or PDF")


async def fetch_link(
    url: str, transport: httpx.AsyncBaseTransport | None = None
) -> tuple[str, str]:
    """(title, text) of a web page."""
    if not re.match(r"^https?://", url):
        raise DocumentError("Links must start with http:// or https://")
    async with httpx.AsyncClient(timeout=10, follow_redirects=True, transport=transport) as c:
        r = await c.get(url, headers={"User-Agent": "MeetingCopilot/0.1 (project knowledge)"})
    if r.status_code >= 400:
        raise DocumentError(f"Couldn't fetch the link ({r.status_code})")
    body = r.text[:MAX_BYTES]
    title = re.search(r"(?is)<title[^>]*>(.*?)</title>", body)
    text = html_to_text(body) if "html" in r.headers.get("content-type", "html") else body
    return (html.unescape(title.group(1)).strip()[:200] if title else url), text


def document_chunks(doc: Document, text: str) -> list[Chunk]:
    """~400-token chunks on paragraph boundaries with ~50 tokens of overlap."""
    paras = [p.strip() for p in re.split(r"\n\s*\n|\n", text) if p.strip()]
    limit, overlap = CHUNK_TOKENS * CHARS_PER_TOKEN, OVERLAP_TOKENS * CHARS_PER_TOKEN
    chunks, cur = [], ""
    for p in paras:
        while len(p) > limit:  # very long paragraph
            chunks.append(p[:limit])
            p = p[limit - overlap :]
        if cur and len(cur) + len(p) + 1 > limit:
            chunks.append(cur)
            cur = cur[-overlap:] + "\n" + p
        else:
            cur = f"{cur}\n{p}" if cur else p
    if cur:
        chunks.append(cur)
    return [Chunk("document", doc.id, f"{doc.title}: {c}", None) for c in chunks if c.strip()]


class LocalBlobs:
    """Files on this machine (development). DOCUMENTS_DIR overrides the folder."""

    def __init__(self, root: str | None = None) -> None:
        self.root = Path(
            root
            or os.environ.get("DOCUMENTS_DIR")
            or Path(__file__).resolve().parents[2] / ".data" / "documents"
        )

    async def put(self, path: str, data: bytes) -> str:
        p = self.root / path
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_bytes(data)
        return path

    async def delete(self, path: str) -> None:
        (self.root / path).unlink(missing_ok=True)


class SupabaseBlobs:
    """Supabase Storage bucket `documents` (needs SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY)."""

    def __init__(self, url: str, key: str, bucket: str = "documents", transport=None) -> None:
        self.base = f"{url.rstrip('/')}/storage/v1/object/{bucket}"
        self.key = key
        self.transport = transport

    async def put(self, path: str, data: bytes) -> str:
        async with httpx.AsyncClient(timeout=30, transport=self.transport) as c:
            r = await c.post(
                f"{self.base}/{path}",
                content=data,
                headers={"Authorization": f"Bearer {self.key}", "x-upsert": "true"},
            )
        if r.status_code >= 400:
            raise DocumentError(f"Storage upload failed ({r.status_code})")
        return path

    async def delete(self, path: str) -> None:
        async with httpx.AsyncClient(timeout=30, transport=self.transport) as c:
            await c.delete(f"{self.base}/{path}", headers={"Authorization": f"Bearer {self.key}"})


def default_blobs():
    url, key = os.environ.get("SUPABASE_URL"), os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
    return SupabaseBlobs(url, key) if url and key else LocalBlobs()


class InMemoryDocuments:
    def __init__(self) -> None:
        self.rows: dict[str, Document] = {}

    async def add(self, d: Document) -> Document:
        self.rows[d.id] = d
        return d

    async def get(self, doc_id: str) -> Document | None:
        return self.rows.get(doc_id)

    async def for_project(self, project_id: str) -> list[Document]:
        return sorted(
            (d for d in self.rows.values() if d.project_id == project_id),
            key=lambda d: d.created_at,
        )

    async def delete(self, doc_id: str) -> None:
        self.rows.pop(doc_id, None)


class PostgresDocuments:
    def __init__(self, store) -> None:
        self.store = store

    async def add(self, d: Document) -> Document:
        async with await self.store.connection() as conn:
            await conn.execute(
                "insert into public.documents (id, project_id, title, source_url, storage_path, uploaded_by) "
                "values (%s, %s, %s, %s, %s, %s)",
                (d.id, d.project_id, d.title, d.source_url, d.storage_path, d.uploaded_by),
            )
        return d

    async def _rows(self, where: str, params: tuple) -> list[Document]:
        async with await self.store.connection() as conn:
            try:
                cur = await conn.execute(
                    "select id, project_id, title, uploaded_by, source_url, storage_path, created_at from public.documents "
                    f"where {where} order by created_at",
                    params,
                )
            except Exception:
                return []
            return [
                Document(str(r[0]), str(r[1]), r[2], str(r[3]), r[4], r[5], r[6].timestamp())
                for r in await cur.fetchall()
            ]

    async def get(self, doc_id: str) -> Document | None:
        rows = await self._rows("id = %s", (doc_id,))
        return rows[0] if rows else None

    async def for_project(self, project_id: str) -> list[Document]:
        return await self._rows("project_id = %s", (project_id,))

    async def delete(self, doc_id: str) -> None:
        async with await self.store.connection() as conn:
            await conn.execute(
                "delete from public.chunks where source_type = 'document' and source_id = %s",
                (doc_id,),
            )
            await conn.execute("delete from public.documents where id = %s", (doc_id,))
