"""Fernet keys from configured secrets.

A secret may be a Fernet key (32 url-safe base64 bytes) or any random string of at least 32
characters, such as one a host generates (Render's `generateValue`); the latter is stretched
into a key with SHA-256, separately for each purpose.
"""

from __future__ import annotations

import base64
import binascii
import hashlib

from cryptography.fernet import Fernet

MIN_SECRET_CHARS = 32


def fernet_from_secret(secret: str, purpose: str) -> Fernet:
    try:
        return Fernet(secret.encode())
    except (ValueError, binascii.Error):
        pass
    if len(secret) < MIN_SECRET_CHARS:
        raise RuntimeError(
            f"The {purpose} key must be a Fernet key or at least {MIN_SECRET_CHARS} characters"
        )
    digest = hashlib.sha256(f"{purpose}:".encode() + secret.encode()).digest()
    return Fernet(base64.urlsafe_b64encode(digest))
