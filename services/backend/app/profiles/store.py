"""Role profiles: who you are in meetings. Drives which questions count as "aimed at you" and
the tone of suggested answers. Presets cover common roles; every field is editable."""

from __future__ import annotations

from pydantic import BaseModel, Field


class RoleProfile(BaseModel):
    name: str = Field(default="", max_length=100)
    aliases: list[str] = Field(default_factory=list, max_length=20)
    title: str = Field(default="", max_length=100)
    responsibilities: str = Field(default="", max_length=2000)
    systems_owned: list[str] = Field(default_factory=list, max_length=50)
    current_tickets: list[str] = Field(default_factory=list, max_length=50)
    speaking_style: str = Field(default="brief and direct", max_length=300)

    def names(self) -> list[str]:
        """Every way people address you, longest first, without blanks or duplicates."""
        out = [n.strip() for n in [self.name, *self.aliases] if n and n.strip()]
        first = self.name.strip().split(" ")[0] if self.name.strip() else ""
        if first and first not in out:
            out.append(first)
        return sorted(dict.fromkeys(out), key=len, reverse=True)


PRESETS: dict[str, RoleProfile] = {
    "devops_sre": RoleProfile(
        title="DevOps/SRE",
        responsibilities="Deployments, CI/CD pipelines, infrastructure, monitoring, on-call and incident response.",
        speaking_style="brief and direct, with exact dates and commands",
    ),
    "developer": RoleProfile(
        title="Software developer",
        responsibilities="Building features, fixing bugs, code reviews and technical estimates.",
        speaking_style="concise, technical, mentions tickets and PRs",
    ),
    "qa": RoleProfile(
        title="QA engineer",
        responsibilities="Test plans, regression testing, bug triage and release sign-off.",
        speaking_style="precise about test status and risks",
    ),
    "product_owner": RoleProfile(
        title="Product owner / Scrum master",
        responsibilities="Backlog, priorities, sprint goals, stakeholder updates and removing blockers.",
        speaking_style="clear about priorities and decisions",
    ),
    "business_analyst": RoleProfile(
        title="Business analyst",
        responsibilities="Requirements, acceptance criteria, process flows and stakeholder questions.",
        speaking_style="structured, refers to requirements",
    ),
    "manager": RoleProfile(
        title="Manager",
        responsibilities="People, delivery status, risks, staffing and cross-team dependencies.",
        speaking_style="short, outcome-focused",
    ),
    "custom": RoleProfile(title="", responsibilities="", speaking_style="brief and direct"),
}


class InMemoryProfiles:
    def __init__(self) -> None:
        self.rows: dict[str, RoleProfile] = {}

    async def get(self, user_id: str) -> RoleProfile | None:
        return self.rows.get(user_id)

    async def put(self, user_id: str, profile: RoleProfile) -> RoleProfile:
        self.rows[user_id] = profile
        return profile


class PostgresProfiles:
    """public.role_profiles (one default profile per user via users.default_role_profile_id)."""

    def __init__(self, store) -> None:
        self.store = store

    async def get(self, user_id: str) -> RoleProfile | None:
        async with await self.store.connection() as conn:
            cur = await conn.execute(
                """select u.name, p.aliases, p.title, p.responsibilities, p.systems_owned, p.current_tickets, p.speaking_style
                   from public.users u join public.role_profiles p on p.id = u.default_role_profile_id
                   where u.id = %s""",
                (user_id,),
            )
            r = await cur.fetchone()
        if not r:
            return None
        return RoleProfile(
            name=r[0] or "",
            aliases=r[1],
            title=r[2],
            responsibilities=r[3],
            systems_owned=r[4],
            current_tickets=r[5],
            speaking_style=r[6],
        )

    async def put(self, user_id: str, p: RoleProfile) -> RoleProfile:
        async with await self.store.connection() as conn, conn.transaction():
            cur = await conn.execute(
                "select default_role_profile_id from public.users where id = %s", (user_id,)
            )
            row = await cur.fetchone()
            pid = row[0] if row else None
            values = (
                p.aliases,
                p.title,
                p.responsibilities,
                p.systems_owned,
                p.current_tickets,
                p.speaking_style,
            )
            if pid:
                await conn.execute(
                    "update public.role_profiles set aliases = %s, title = %s, responsibilities = %s, systems_owned = %s, "
                    "current_tickets = %s, speaking_style = %s where id = %s",
                    (*values, pid),
                )
            else:
                cur = await conn.execute(
                    "insert into public.role_profiles (user_id, aliases, title, responsibilities, systems_owned, "
                    "current_tickets, speaking_style) values (%s, %s, %s, %s, %s, %s, %s) returning id",
                    (user_id, *values),
                )
                pid = (await cur.fetchone())[0]  # type: ignore[index]
            await conn.execute(
                "update public.users set name = %s, default_role_profile_id = %s where id = %s",
                (p.name, pid, user_id),
            )
        return p
