"""Voiceprints are biometric data: encrypted with their own key (VOICEPRINT_KEY), stored only
with the person's consent, deletable. Never returned by any API."""

from __future__ import annotations

import base64
import hashlib
import logging
import os
import struct
from functools import lru_cache

from cryptography.fernet import Fernet, InvalidToken

log = logging.getLogger("app.voiceprints")


@lru_cache(maxsize=1)
def _fernet() -> Fernet:
    key = os.environ.get("VOICEPRINT_KEY")
    if key:
        return Fernet(key.encode())
    # Development only: derive a key so enrollment works locally. Set VOICEPRINT_KEY in production
    # (python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())").
    log.warning("VOICEPRINT_KEY is not set; deriving a development key from BACKEND_SECRET")
    from app.auth import backend_secret

    digest = hashlib.sha256(b"voiceprint:" + backend_secret().encode()).digest()
    return Fernet(base64.urlsafe_b64encode(digest))


def seal(vector: list[float]) -> bytes:
    return _fernet().encrypt(struct.pack(f"<{len(vector)}f", *vector))


def unseal(blob: bytes) -> list[float]:
    try:
        raw = _fernet().decrypt(bytes(blob))
    except InvalidToken as e:
        raise ValueError("voiceprint can't be decrypted with the current VOICEPRINT_KEY") from e
    return list(struct.unpack(f"<{len(raw) // 4}f", raw))
