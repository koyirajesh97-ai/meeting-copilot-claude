"""Row-level security: who can see and change what, checked as each user against real Postgres."""

from __future__ import annotations

import json
import uuid
from collections.abc import Iterator
from contextlib import contextmanager

import psycopg
import pytest
from psycopg import errors

OWNER = str(uuid.UUID(int=1))
MEMBER = str(uuid.UUID(int=2))
VIEWER = str(uuid.UUID(int=3))
OUTSIDER = str(uuid.UUID(int=4))


@contextmanager
def as_user(dsn: str, user_id: str | None) -> Iterator[psycopg.Connection]:
    """A transaction running as Supabase's `authenticated` role with this user's JWT (or anon)."""
    with psycopg.connect(dsn) as conn:
        role = "authenticated" if user_id else "anon"
        conn.execute(f"set local role {role}")
        claims = json.dumps({"sub": user_id, "role": role}) if user_id else "{}"
        conn.execute("select set_config('request.jwt.claims', %s, true)", (claims,))
        yield conn
        conn.rollback()


def count(conn: psycopg.Connection, sql: str, params: tuple = ()) -> int:
    return len(conn.execute(sql, params).fetchall())


@pytest.fixture
def world(pg_dsn: str) -> dict[str, str]:
    """A project (owner, member, viewer), an outsider, and meetings of each visibility."""
    ids: dict[str, str] = {}
    with psycopg.connect(pg_dsn, autocommit=True) as c:
        for uid, email in [
            (OWNER, "o@x.io"),
            (MEMBER, "m@x.io"),
            (VIEWER, "v@x.io"),
            (OUTSIDER, "z@x.io"),
        ]:
            c.execute("insert into auth.users (id, email) values (%s, %s)", (uid, email))
            c.execute("insert into public.users (id, email) values (%s, %s)", (uid, email))
        ids["project"] = str(
            c.execute(
                "insert into public.projects (name, created_by) values ('Payments', %s) returning id",
                (OWNER,),
            ).fetchone()[0]
        )
        c.execute(
            "insert into public.project_members values (%s, %s, 'member'), (%s, %s, 'viewer')",
            (ids["project"], MEMBER, ids["project"], VIEWER),
        )
        for key, owner, vis in [
            ("shared", OWNER, "project"),
            ("private", OWNER, "private"),
            ("member_private", MEMBER, "private"),
        ]:
            ids[key] = str(
                c.execute(
                    "insert into public.meetings (owner_id, project_id, type, title, visibility) "
                    "values (%s, %s, 'standup', %s, %s) returning id",
                    (owner, ids["project"], key, vis),
                ).fetchone()[0]
            )
            c.execute(
                "insert into public.transcript_segments (meeting_id, segment_id, speaker_id, channel, start_ms, end_ms, text) "
                "values (%s, 'seg_1', 'me', 'mic', 0, 1000, %s)",
                (ids[key], f"{key} words"),
            )
            c.execute(
                "insert into public.summaries (meeting_id, template) values (%s, 'standup')",
                (ids[key],),
            )
            c.execute(
                "insert into public.suggestions (meeting_id, kind, text) values (%s, 'answer', 'card')",
                (ids[key],),
            )
            c.execute(
                "insert into public.action_items (project_id, meeting_id, text, created_by) values (%s, %s, %s, %s)",
                (ids["project"], ids[key], f"{key} item", owner),
            )
            c.execute(
                "insert into public.chunks (source_type, source_id, project_id, meeting_id, owner_id, text) "
                "values ('transcript', 'seg_1', %s, %s, %s, %s)",
                (ids["project"], ids[key], owner, f"{key} chunk"),
            )
        c.execute(
            "insert into public.speakers (project_id, user_id, display_name, voiceprint, consent_at) "
            "values (%s, %s, 'Owner', '\\x0102', now())",
            (ids["project"], OWNER),
        )
    ids["dsn"] = pg_dsn
    return ids


def test_creator_becomes_project_owner(world) -> None:
    with as_user(world["dsn"], OWNER) as c:
        assert (
            c.execute("select role from project_members where user_id = %s", (OWNER,)).fetchone()[0]
            == "owner"
        )


@pytest.mark.parametrize(
    ("user", "visible"),
    [
        (OWNER, {"shared", "private"}),
        (MEMBER, {"shared", "member_private"}),
        (VIEWER, {"shared"}),
        (OUTSIDER, set()),
    ],
)
def test_meetings_visible_by_ownership_and_project_sharing(world, user, visible) -> None:
    with as_user(world["dsn"], user) as c:
        titles = {r[0] for r in c.execute("select title from meetings")}
        assert titles == visible
        # Everything hanging off a meeting follows the same rule.
        for sql, suffix in [
            ("select text from transcript_segments", " words"),
            ("select text from action_items", " item"),
            ("select text from chunks", " chunk"),
        ]:
            assert {r[0].removesuffix(suffix) for r in c.execute(sql)} == visible
        assert count(c, "select 1 from summaries") == len(visible)


def test_outsiders_see_nothing_at_all(world) -> None:
    with as_user(world["dsn"], OUTSIDER) as c:
        for table in [
            "projects",
            "project_members",
            "meetings",
            "transcript_segments",
            "summaries",
            "suggestions",
            "action_items",
            "chunks",
            "speakers",
            "documents",
            "decisions",
        ]:
            assert count(c, f"select 1 from {table}") == 0, table
        assert {r[0] for r in c.execute("select id::text from users")} == {OUTSIDER}


def test_anonymous_requests_are_refused(world) -> None:
    with as_user(world["dsn"], None) as c, pytest.raises(errors.InsufficientPrivilege):
        c.execute("select 1 from meetings")


def test_cards_stay_private_to_the_meeting_owner_even_when_shared(world) -> None:
    with as_user(world["dsn"], MEMBER) as c:
        mine = {str(r[0]) for r in c.execute("select meeting_id from suggestions")}
        assert mine == {world["member_private"]}
    with as_user(world["dsn"], OWNER) as c:
        assert count(c, "select 1 from suggestions") == 2


def test_voiceprints_are_never_readable(world) -> None:
    with as_user(world["dsn"], MEMBER) as c:
        assert c.execute("select display_name from speakers").fetchall() == [("Owner",)]
        with pytest.raises(errors.InsufficientPrivilege):
            c.execute("select voiceprint from speakers")
    with as_user(world["dsn"], OWNER) as c, pytest.raises(errors.InsufficientPrivilege):
        c.execute("select voiceprint from speakers")


def test_voiceprint_requires_consent(world) -> None:
    with psycopg.connect(world["dsn"], autocommit=True) as c, pytest.raises(errors.CheckViolation):
        c.execute(
            "insert into speakers (user_id, display_name, voiceprint) values (%s, 'x', '\\x01')",
            (MEMBER,),
        )


def test_only_owners_write_their_meetings(world) -> None:
    with as_user(world["dsn"], MEMBER) as c:
        r = c.execute("update meetings set title = 'hacked' where id = %s", (world["shared"],))
        assert r.rowcount == 0
        with pytest.raises(errors.InsufficientPrivilege):
            c.execute(
                "insert into transcript_segments (meeting_id, segment_id, speaker_id, channel, start_ms, end_ms, text) "
                "values (%s, 'x', 'me', 'mic', 0, 1, 'forged')",
                (world["shared"],),
            )
    with as_user(world["dsn"], OWNER) as c:
        assert (
            c.execute(
                "update meetings set title = 'renamed' where id = %s", (world["shared"],)
            ).rowcount
            == 1
        )


def test_viewers_cannot_create_meetings_in_the_project_but_members_can(world) -> None:
    sql = (
        "insert into meetings (owner_id, project_id, type, visibility) values (%s, %s, 'review', 'project') "
        "returning id"
    )
    with as_user(world["dsn"], MEMBER) as c:
        assert c.execute(sql, (MEMBER, world["project"])).fetchone()
    with as_user(world["dsn"], VIEWER) as c, pytest.raises(errors.InsufficientPrivilege):
        c.execute(sql, (VIEWER, world["project"]))
    with as_user(world["dsn"], OUTSIDER) as c, pytest.raises(errors.InsufficientPrivilege):
        c.execute(sql, (OUTSIDER, world["project"]))
    with as_user(world["dsn"], MEMBER) as c, pytest.raises(errors.InsufficientPrivilege):
        c.execute(sql, (OWNER, world["project"]))  # can't create meetings as someone else


def test_sharing_needs_a_project(world) -> None:
    with as_user(world["dsn"], OUTSIDER) as c, pytest.raises(errors.CheckViolation):
        c.execute(
            "insert into meetings (owner_id, type, visibility) values (%s, 'custom', 'project')",
            (OUTSIDER,),
        )


def test_only_project_owners_manage_membership(world) -> None:
    with as_user(world["dsn"], MEMBER) as c:
        with pytest.raises(errors.InsufficientPrivilege):
            c.execute(
                "insert into project_members values (%s, %s, 'owner')", (world["project"], OUTSIDER)
            )
    with as_user(world["dsn"], MEMBER) as c:
        assert (
            c.execute(
                "update project_members set role = 'owner' where user_id = %s", (MEMBER,)
            ).rowcount
            == 0
        )
    with as_user(world["dsn"], OWNER) as c:
        c.execute(
            "insert into project_members values (%s, %s, 'viewer')", (world["project"], OUTSIDER)
        )
        c.commit()
    with as_user(world["dsn"], OUTSIDER) as c:
        assert {r[0] for r in c.execute("select title from meetings")} == {"shared"}


def test_role_profiles_and_standups_are_personal(world) -> None:
    with psycopg.connect(world["dsn"], autocommit=True) as c:
        c.execute("insert into role_profiles (user_id, title) values (%s, 'SRE')", (OWNER,))
        c.execute(
            "insert into standup_entries (user_id, project_id, script) values (%s, %s, 'my update')",
            (OWNER, world["project"]),
        )
    with as_user(world["dsn"], MEMBER) as c:
        assert count(c, "select 1 from role_profiles") == 0
        assert count(c, "select 1 from standup_entries") == 0
    with as_user(world["dsn"], OWNER) as c:
        assert count(c, "select 1 from role_profiles") == 1
        assert count(c, "select 1 from standup_entries") == 1


def test_project_members_see_each_others_names(world) -> None:
    with as_user(world["dsn"], VIEWER) as c:
        assert {r[0] for r in c.execute("select email from users")} == {
            "o@x.io",
            "m@x.io",
            "v@x.io",
        }


def test_deleting_a_meeting_removes_everything_hanging_off_it(world) -> None:
    with as_user(world["dsn"], OWNER) as c:
        c.execute("delete from meetings where id = %s", (world["private"],))
        c.commit()
    with psycopg.connect(world["dsn"]) as c:
        for table in ["transcript_segments", "summaries", "suggestions", "action_items", "chunks"]:
            assert (
                count(c, f"select 1 from {table} where meeting_id = %s", (world["private"],)) == 0
            ), table
