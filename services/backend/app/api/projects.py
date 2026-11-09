"""Projects: CRUD, members and invites, vocabulary, documents (project knowledge), and the
action-item board. Owners manage the project; members add meetings and documents; viewers read."""

from __future__ import annotations

from datetime import UTC, date, datetime
from typing import Annotated, Literal

from fastapi import APIRouter, File, Form, HTTPException, UploadFile, status
from pydantic import BaseModel, EmailStr, Field

from app.auth import CurrentUser
from app.profiles.store import RoleProfile
from app.projects.documents import (
    Document,
    DocumentError,
    document_chunks,
    extract_text,
    fetch_link,
    new_document_id,
    resolve_host,
    safe_filename,
)
from app.projects.invites import send_invite_email
from app.projects.store import ROLES, WRITERS, Project, Role, new_project_id
from app.search.index import DocRef
from app.services import services

router = APIRouter()


class ProjectOut(BaseModel):
    id: str
    name: str
    description: str
    vocabulary: list[str]
    role: Role


async def _role(
    project_id: str, user_id: str, allowed: tuple[Role, ...] = ROLES
) -> tuple[Project, Role]:
    s = services()
    p = await s.projects.get(project_id)
    role = await s.projects.role(project_id, user_id) if p else None
    if p is None or role is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Project not found")
    if role not in allowed:
        raise HTTPException(
            status.HTTP_403_FORBIDDEN, f"Needs project role: {' or '.join(allowed)}"
        )
    return p, role


def _out(p: Project, role: Role) -> ProjectOut:
    return ProjectOut(
        id=p.id, name=p.name, description=p.description, vocabulary=p.vocabulary, role=role
    )


class ProjectIn(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    description: str = Field(default="", max_length=2000)


@router.get("/projects", response_model=list[ProjectOut])
async def list_projects(user: CurrentUser) -> list[ProjectOut]:
    return [_out(p, r) for p, r in await services().projects.for_user(user.user_id)]


@router.post("/projects", response_model=ProjectOut, status_code=status.HTTP_201_CREATED)
async def create_project(body: ProjectIn, user: CurrentUser) -> ProjectOut:
    p = await services().projects.create(
        Project(new_project_id(), body.name.strip(), user.user_id, body.description)
    )
    return _out(p, "owner")


@router.get("/projects/{project_id}", response_model=ProjectOut)
async def get_project(project_id: str, user: CurrentUser) -> ProjectOut:
    return _out(*await _role(project_id, user.user_id))


class ProjectEdit(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=200)
    description: str | None = Field(default=None, max_length=2000)


@router.patch("/projects/{project_id}", response_model=ProjectOut)
async def edit_project(project_id: str, body: ProjectEdit, user: CurrentUser) -> ProjectOut:
    p, role = await _role(project_id, user.user_id, ("owner",))
    if body.name is not None:
        p.name = body.name.strip()
    if body.description is not None:
        p.description = body.description
    return _out(await services().projects.update(p), role)


@router.delete("/projects/{project_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_project(project_id: str, user: CurrentUser) -> None:
    """Deletes the project, its documents and invites. Its meetings stay with their owners, as private."""
    await _role(project_id, user.user_id, ("owner",))
    s = services()
    for d in await s.documents.for_project(project_id):
        await _delete_document(d)
    await s.meetings.detach_project(project_id)
    await s.projects.delete(project_id)


# ---------- members ----------


class MemberOut(BaseModel):
    user_id: str | None
    email: str | None
    name: str | None
    role: Role
    pending: bool = False


class Invite(BaseModel):
    email: EmailStr
    role: Role = "member"


class InviteResult(BaseModel):
    status: Literal["added", "invited"]
    email_sent: bool


@router.get("/projects/{project_id}/members", response_model=list[MemberOut])
async def members(project_id: str, user: CurrentUser) -> list[MemberOut]:
    await _role(project_id, user.user_id)
    s = services()
    out = [
        MemberOut(user_id=m.user_id, email=m.email, name=m.name, role=m.role)
        for m in await s.projects.member_list(project_id)
    ]
    out += [
        MemberOut(user_id=None, email=e, name=None, role=r, pending=True)
        for e, r in await s.projects.invites_for_project(project_id)
    ]
    return out


@router.post(
    "/projects/{project_id}/members",
    response_model=InviteResult,
    status_code=status.HTTP_201_CREATED,
)
async def invite(project_id: str, body: Invite, user: CurrentUser) -> InviteResult:
    """Existing users join right away; anyone else gets an invite (accepted when they sign in)."""
    await _role(project_id, user.user_id, ("owner",))
    s = services()
    email = body.email.lower()
    existing = await s.projects.user_by_email(email)
    if existing:
        await s.projects.set_member(project_id, existing, body.role)
        return InviteResult(status="added", email_sent=False)
    await s.projects.add_invite(project_id, email, body.role, user.user_id)
    return InviteResult(status="invited", email_sent=await send_invite_email(email))


class RoleChange(BaseModel):
    role: Role


async def _owners(project_id: str) -> list[str]:
    return [
        m.user_id for m in await services().projects.member_list(project_id) if m.role == "owner"
    ]


@router.patch("/projects/{project_id}/members/{member_id}", status_code=status.HTTP_204_NO_CONTENT)
async def change_role(project_id: str, member_id: str, body: RoleChange, user: CurrentUser) -> None:
    await _role(project_id, user.user_id, ("owner",))
    s = services()
    if await s.projects.role(project_id, member_id) is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Not a member")
    if body.role != "owner" and await _owners(project_id) == [member_id]:
        raise HTTPException(status.HTTP_409_CONFLICT, "A project needs at least one owner")
    await s.projects.set_member(project_id, member_id, body.role)


@router.delete("/projects/{project_id}/members/{member_id}", status_code=status.HTTP_204_NO_CONTENT)
async def remove_member(project_id: str, member_id: str, user: CurrentUser) -> None:
    """Owners remove anyone; anyone can leave. Their voiceprint in this project is deleted too."""
    allowed: tuple[Role, ...] = ROLES if member_id == user.user_id else ("owner",)
    await _role(project_id, user.user_id, allowed)
    s = services()
    if await _owners(project_id) == [member_id]:
        raise HTTPException(status.HTTP_409_CONFLICT, "A project needs at least one owner")
    await s.projects.remove_member(project_id, member_id)
    await s.speakers.delete_for_member(project_id, member_id)


# ---------- vocabulary ----------


class Vocabulary(BaseModel):
    terms: list[str] = Field(default_factory=list, max_length=500)


@router.get("/projects/{project_id}/vocabulary", response_model=Vocabulary)
async def get_vocabulary(project_id: str, user: CurrentUser) -> Vocabulary:
    p, _ = await _role(project_id, user.user_id)
    return Vocabulary(terms=p.vocabulary)


@router.put("/projects/{project_id}/vocabulary", response_model=Vocabulary)
async def put_vocabulary(project_id: str, body: Vocabulary, user: CurrentUser) -> Vocabulary:
    """Names, systems and acronyms ("ArgoCD = GitOps deploy tool"): transcription key terms and Clarify."""
    p, _ = await _role(project_id, user.user_id, WRITERS)
    p.vocabulary = list(dict.fromkeys(t.strip()[:200] for t in body.terms if t.strip()))
    await services().projects.update(p)
    return Vocabulary(terms=p.vocabulary)


# ---------- documents ----------


class DocumentOut(BaseModel):
    id: str
    title: str
    source_url: str | None
    uploaded_by: str
    created_at: float
    chunks: int | None = None


def _doc_out(d: Document, chunks: int | None = None) -> DocumentOut:
    return DocumentOut(
        id=d.id,
        title=d.title,
        source_url=d.source_url,
        uploaded_by=d.uploaded_by,
        created_at=d.created_at,
        chunks=chunks,
    )


async def _index(d: Document, text: str) -> int:
    s = services()
    chunks = document_chunks(d, text)
    if not chunks:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "No text found in that document")
    vectors, _ = await s.search.embed_or_none([c.text for c in chunks])
    await s.search.index.replace_document(
        DocRef(d.id, d.project_id, d.title, d.uploaded_by, d.created_at), chunks, vectors
    )
    return len(chunks)


@router.post(
    "/projects/{project_id}/documents",
    response_model=DocumentOut,
    status_code=status.HTTP_201_CREATED,
)
async def upload_document(
    project_id: str,
    user: CurrentUser,
    file: Annotated[UploadFile, File()],
    title: Annotated[str | None, Form(max_length=200)] = None,
) -> DocumentOut:
    await _role(project_id, user.user_id, WRITERS)
    data = await file.read(5 * 1024 * 1024 + 1)
    name = safe_filename(file.filename or "document.txt")
    try:
        text = extract_text(name, data)
    except DocumentError as e:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, str(e)) from e
    s = services()
    doc_id = new_document_id()
    path = await s.blobs.put(f"{project_id}/{doc_id}/{name}", data)
    d = Document(doc_id, project_id, (title or name).strip(), user.user_id, storage_path=path)
    n = await _index(d, text)
    await s.documents.add(d)
    return _doc_out(d, n)


class LinkIn(BaseModel):
    url: str = Field(max_length=2000)
    title: str | None = Field(default=None, max_length=200)


@router.post(
    "/projects/{project_id}/links", response_model=DocumentOut, status_code=status.HTTP_201_CREATED
)
async def add_link(project_id: str, body: LinkIn, user: CurrentUser) -> DocumentOut:
    await _role(project_id, user.user_id, WRITERS)
    try:
        s = services()
        page_title, text = await fetch_link(
            body.url, s.link_transport, s.link_resolve or resolve_host
        )
    except DocumentError as e:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, str(e)) from e
    d = Document(
        new_document_id(),
        project_id,
        (body.title or page_title).strip(),
        user.user_id,
        source_url=body.url,
    )
    n = await _index(d, text)
    await services().documents.add(d)
    return _doc_out(d, n)


@router.get("/projects/{project_id}/documents", response_model=list[DocumentOut])
async def list_documents(project_id: str, user: CurrentUser) -> list[DocumentOut]:
    await _role(project_id, user.user_id)
    return [_doc_out(d) for d in await services().documents.for_project(project_id)]


async def _delete_document(d: Document) -> None:
    s = services()
    await s.search.index.delete_document(d.id)
    if d.storage_path:
        await s.blobs.delete(d.storage_path)
    await s.documents.delete(d.id)


@router.delete("/projects/{project_id}/documents/{doc_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_document(project_id: str, doc_id: str, user: CurrentUser) -> None:
    _, role = await _role(project_id, user.user_id)
    d = await services().documents.get(doc_id)
    if d is None or d.project_id != project_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Document not found")
    if role != "owner" and d.uploaded_by != user.user_id:
        raise HTTPException(
            status.HTTP_403_FORBIDDEN, "Only the uploader or a project owner can remove it"
        )
    await _delete_document(d)


# ---------- action-item board ----------


class BoardItem(BaseModel):
    id: str
    text: str
    owner: str | None
    due: str | None
    status: str
    source: str
    meeting_id: str
    meeting_title: str
    overdue: bool


def _overdue(due: str | None, status_: str) -> bool:
    if not due or status_ != "open":
        return False
    try:
        return date.fromisoformat(due) < datetime.now(UTC).date()
    except ValueError:
        return False


@router.get("/action-items", response_model=list[BoardItem])
async def board(
    user: CurrentUser, project_id: str, filter: Literal["all", "mine", "overdue"] = "all"
) -> list[BoardItem]:
    """A project's action items from meetings shared with it. "mine": owner is you (by your profile name)."""
    await _role(project_id, user.user_id)
    s = services()
    profile = await s.profiles.get(user.user_id) or RoleProfile()
    names = {n.lower() for n in profile.names()} | ({user.email.lower()} if user.email else set())
    out = []
    for i, m in await s.meetings.project_action_items(project_id):
        item = BoardItem(
            id=i.id,
            text=i.text,
            owner=i.owner,
            due=i.due_text,
            status=i.status,
            source=i.source,
            meeting_id=m.id,
            meeting_title=m.title,
            overdue=_overdue(i.due_text, i.status),
        )
        if filter == "mine" and not (i.owner and i.owner.lower() in names):
            continue
        if filter == "overdue" and not item.overdue:
            continue
        out.append(item)
    return out


class ItemEdit(BaseModel):
    status: Literal["open", "done", "dropped"] | None = None
    owner: str | None = Field(default=None, max_length=100)
    due: str | None = Field(default=None, max_length=50)


@router.patch("/action-items/{item_id}", response_model=BoardItem)
async def edit_item(item_id: str, body: ItemEdit, user: CurrentUser) -> BoardItem:
    """The meeting owner, or a project owner/member when the meeting is shared."""
    s = services()
    found = await s.meetings.get_action_item(item_id)
    if found is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Action item not found")
    item, m = found
    allowed = m.owner_id == user.user_id or (
        m.visibility == "project" and await s.projects.role(m.project_id, user.user_id) in WRITERS
    )
    if not allowed:
        visible = m.visibility == "project" and await s.projects.role(m.project_id, user.user_id)
        raise HTTPException(
            status.HTTP_403_FORBIDDEN if visible else status.HTTP_404_NOT_FOUND,
            "You can't change this item" if visible else "Action item not found",
        )
    await s.meetings.update_action_item(
        item_id, status=body.status, owner=body.owner, due_text=body.due
    )
    item, m = await s.meetings.get_action_item(item_id)  # type: ignore[misc]
    return BoardItem(
        id=item.id,
        text=item.text,
        owner=item.owner,
        due=item.due_text,
        status=item.status,
        source=item.source,
        meeting_id=m.id,
        meeting_title=m.title,
        overdue=_overdue(item.due_text, item.status),
    )
