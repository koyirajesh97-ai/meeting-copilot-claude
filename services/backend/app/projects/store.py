"""Projects, members (owner / member / viewer) and pending email invites."""

from __future__ import annotations

import time
import uuid
from dataclasses import dataclass, field
from typing import Literal

Role = Literal["owner", "member", "viewer"]
ROLES: tuple[Role, ...] = ("owner", "member", "viewer")
WRITERS: tuple[Role, ...] = ("owner", "member")


@dataclass
class Project:
    id: str
    name: str
    created_by: str
    description: str = ""
    vocabulary: list[str] = field(default_factory=list)
    created_at: float = field(default_factory=time.time)


@dataclass
class Member:
    user_id: str
    role: Role
    email: str | None = None
    name: str | None = None


def new_project_id() -> str:
    return str(uuid.uuid4())


class InMemoryProjects:
    def __init__(self) -> None:
        self.projects: dict[str, Project] = {}
        self.members: dict[str, dict[str, Role]] = {}
        self.invites: dict[tuple[str, str], tuple[Role, str]] = {}
        #: user_id -> email; filled when people sign in (in Postgres this is public.users).
        self.users: dict[str, str | None] = {}

    async def register_user(self, user_id: str, email: str | None) -> None:
        self.users[user_id] = email.lower() if email else None

    async def user_by_email(self, email: str) -> str | None:
        return next((u for u, e in self.users.items() if e == email.lower()), None)

    async def create(self, p: Project) -> Project:
        self.projects[p.id] = p
        self.members[p.id] = {p.created_by: "owner"}
        return p

    async def get(self, project_id: str) -> Project | None:
        return self.projects.get(project_id)

    async def update(self, p: Project) -> Project:
        self.projects[p.id] = p
        return p

    async def delete(self, project_id: str) -> None:
        self.projects.pop(project_id, None)
        self.members.pop(project_id, None)
        for k in [k for k in self.invites if k[0] == project_id]:
            del self.invites[k]

    async def for_user(self, user_id: str) -> list[tuple[Project, Role]]:
        return [
            (self.projects[pid], m[user_id])
            for pid, m in self.members.items()
            if user_id in m and pid in self.projects
        ]

    async def role(self, project_id: str | None, user_id: str) -> Role | None:
        return self.members.get(project_id or "", {}).get(user_id)

    async def member_list(self, project_id: str) -> list[Member]:
        return [
            Member(u, r, self.users.get(u)) for u, r in self.members.get(project_id, {}).items()
        ]

    async def set_member(self, project_id: str, user_id: str, role: Role) -> None:
        self.members.setdefault(project_id, {})[user_id] = role

    async def remove_member(self, project_id: str, user_id: str) -> None:
        self.members.get(project_id, {}).pop(user_id, None)

    async def add_invite(self, project_id: str, email: str, role: Role, invited_by: str) -> None:
        self.invites[(project_id, email.lower())] = (role, invited_by)

    async def invites_for_project(self, project_id: str) -> list[tuple[str, Role]]:
        return [(e, r) for (p, e), (r, _by) in self.invites.items() if p == project_id]

    async def accept_invites(self, user_id: str, email: str | None) -> list[str]:
        """Turn pending invites for this email into memberships. Returns the project ids."""
        if not email:
            return []
        joined = []
        for (pid, e), (role, _by) in list(self.invites.items()):
            if e == email.lower() and pid in self.projects:
                self.members[pid][user_id] = role
                del self.invites[(pid, e)]
                joined.append(pid)
        return joined


class PostgresProjects:
    def __init__(self, store) -> None:
        self.store = store

    async def register_user(self, user_id: str, email: str | None) -> None:
        return None  # public.users is maintained by the meeting store on sign-in

    async def user_by_email(self, email: str) -> str | None:
        async with await self.store.connection() as conn:
            cur = await conn.execute(
                "select id from public.users where lower(email) = lower(%s)", (email,)
            )
            r = await cur.fetchone()
            return str(r[0]) if r else None

    async def create(self, p: Project) -> Project:
        async with await self.store.connection() as conn:
            # The add_project_owner trigger makes the creator the owner.
            await conn.execute(
                "insert into public.projects (id, name, description, vocabulary, created_by) values (%s, %s, %s, %s, %s)",
                (p.id, p.name, p.description, p.vocabulary, p.created_by),
            )
        return p

    @staticmethod
    def _row(r) -> Project:
        return Project(str(r[0]), r[1], str(r[4]), r[2], list(r[3] or []), r[5].timestamp())

    async def get(self, project_id: str) -> Project | None:
        async with await self.store.connection() as conn:
            try:
                cur = await conn.execute(
                    "select id, name, description, vocabulary, created_by, created_at from public.projects where id = %s",
                    (project_id,),
                )
            except Exception:
                return None
            r = await cur.fetchone()
            return self._row(r) if r else None

    async def update(self, p: Project) -> Project:
        async with await self.store.connection() as conn:
            await conn.execute(
                "update public.projects set name = %s, description = %s, vocabulary = %s where id = %s",
                (p.name, p.description, p.vocabulary, p.id),
            )
        return p

    async def delete(self, project_id: str) -> None:
        async with await self.store.connection() as conn:
            await conn.execute("delete from public.projects where id = %s", (project_id,))

    async def for_user(self, user_id: str) -> list[tuple[Project, Role]]:
        async with await self.store.connection() as conn:
            cur = await conn.execute(
                "select p.id, p.name, p.description, p.vocabulary, p.created_by, p.created_at, m.role "
                "from public.projects p join public.project_members m on m.project_id = p.id where m.user_id = %s "
                "order by p.created_at",
                (user_id,),
            )
            return [(self._row(r), r[6]) for r in await cur.fetchall()]

    async def role(self, project_id: str | None, user_id: str) -> Role | None:
        if not project_id:
            return None
        async with await self.store.connection() as conn:
            try:
                cur = await conn.execute(
                    "select role from public.project_members where project_id = %s and user_id = %s",
                    (project_id, user_id),
                )
            except Exception:
                return None
            r = await cur.fetchone()
            return r[0] if r else None

    async def member_list(self, project_id: str) -> list[Member]:
        async with await self.store.connection() as conn:
            cur = await conn.execute(
                "select m.user_id, m.role, u.email, u.name from public.project_members m join public.users u on u.id = m.user_id "
                "where m.project_id = %s order by m.created_at",
                (project_id,),
            )
            return [Member(str(r[0]), r[1], r[2], r[3]) for r in await cur.fetchall()]

    async def set_member(self, project_id: str, user_id: str, role: Role) -> None:
        async with await self.store.connection() as conn:
            await conn.execute(
                "insert into public.project_members (project_id, user_id, role) values (%s, %s, %s) "
                "on conflict (project_id, user_id) do update set role = excluded.role",
                (project_id, user_id, role),
            )

    async def remove_member(self, project_id: str, user_id: str) -> None:
        async with await self.store.connection() as conn:
            await conn.execute(
                "delete from public.project_members where project_id = %s and user_id = %s",
                (project_id, user_id),
            )

    async def add_invite(self, project_id: str, email: str, role: Role, invited_by: str) -> None:
        async with await self.store.connection() as conn:
            await conn.execute(
                "insert into public.project_invites (project_id, email, role, invited_by) values (%s, lower(%s), %s, %s) "
                "on conflict (project_id, email) do update set role = excluded.role",
                (project_id, email, role, invited_by),
            )

    async def invites_for_project(self, project_id: str) -> list[tuple[str, Role]]:
        async with await self.store.connection() as conn:
            cur = await conn.execute(
                "select email, role from public.project_invites where project_id = %s order by email",
                (project_id,),
            )
            return [(r[0], r[1]) for r in await cur.fetchall()]

    async def accept_invites(self, user_id: str, email: str | None) -> list[str]:
        if not email:
            return []
        async with await self.store.connection() as conn, conn.transaction():
            cur = await conn.execute(
                "delete from public.project_invites where email = lower(%s) returning project_id, role",
                (email,),
            )
            rows = await cur.fetchall()
            for pid, role in rows:
                await conn.execute(
                    "insert into public.project_members (project_id, user_id, role) values (%s, %s, %s) "
                    "on conflict (project_id, user_id) do nothing",
                    (pid, user_id, role),
                )
            return [str(r[0]) for r in rows]
