"""Requests to addresses a user typed (project links, a Jira site) may only reach the public
internet: never this server, its private network or the cloud's metadata service.

`public_ip` resolves the host once and checks every address; `pinned` then connects to that
exact address (Host header and TLS SNI keep the real name, so the certificate is still checked
against it). Resolving twice would let a DNS answer change between the check and the connection
(DNS rebinding).
"""

from __future__ import annotations

import asyncio
import ipaddress
import socket
from collections.abc import Awaitable, Callable
from urllib.parse import urlsplit, urlunsplit

Resolve = Callable[[str, int], Awaitable[list[str]]]

BLOCKED_SUFFIXES = (".localhost", ".internal", ".local")


class UnsafeUrl(ValueError):
    pass


async def resolve_host(host: str, port: int) -> list[str]:
    infos = await asyncio.get_running_loop().getaddrinfo(host, port, type=socket.SOCK_STREAM)
    return [str(i[4][0]) for i in infos]


def _is_public(addr: str) -> bool:
    ip = ipaddress.ip_address(addr.split("%")[0])
    if ip.version == 6 and ip.ipv4_mapped:  # ::ffff:10.0.0.5 is 10.0.0.5
        ip = ip.ipv4_mapped
    return ip.is_global and not ip.is_multicast


async def public_ip(url: str, resolve: Resolve = resolve_host) -> str:
    """The address to connect to for `url`, if every address its host resolves to is public."""
    parts = urlsplit(url)
    if parts.scheme not in ("http", "https") or not parts.hostname:
        raise UnsafeUrl("The address must start with http:// or https://")
    host = parts.hostname.lower().rstrip(".")
    private = UnsafeUrl("That address is private (this server or its network).")
    if host == "localhost" or host.endswith(BLOCKED_SUFFIXES):
        raise private
    try:
        addrs = await resolve(host, parts.port or (443 if parts.scheme == "https" else 80))
    except OSError as e:
        raise UnsafeUrl(f"Couldn't find {host}.") from e
    if not addrs:
        raise UnsafeUrl(f"Couldn't find {host}.")
    try:
        if not all(_is_public(a) for a in addrs):
            raise private
    except ValueError as e:
        if isinstance(e, UnsafeUrl):
            raise
        raise private from e
    return addrs[0].split("%")[0]


def pinned(url: str, ip: str) -> tuple[str, dict[str, str], dict[str, str]]:
    """(url with the host replaced by `ip`, headers, httpx request extensions)."""
    parts = urlsplit(url)
    host = parts.hostname or ""
    port = f":{parts.port}" if parts.port else ""
    netloc = (f"[{ip}]" if ":" in ip else ip) + port
    return (
        urlunsplit((parts.scheme, netloc, parts.path or "/", parts.query, "")),
        {"Host": host + port},
        {"sni_hostname": host} if parts.scheme == "https" else {},
    )
