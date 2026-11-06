import pytest
from cryptography.fernet import Fernet, InvalidToken

from app.secrets import fernet_from_secret


def test_a_fernet_key_is_used_as_is():
    key = Fernet.generate_key().decode()
    sealed = Fernet(key.encode()).encrypt(b"x")
    assert fernet_from_secret(key, "voiceprint").decrypt(sealed) == b"x"


def test_a_long_random_secret_becomes_a_key_per_purpose():
    secret = "r" * 40  # e.g. a host-generated value, not Fernet-shaped
    voice = fernet_from_secret(secret, "voiceprint")
    integrations = fernet_from_secret(secret, "integrations")
    sealed = voice.encrypt(b"x")
    assert fernet_from_secret(secret, "voiceprint").decrypt(sealed) == b"x"
    with pytest.raises(InvalidToken):
        integrations.decrypt(sealed)  # the two purposes never share a key


def test_short_secrets_are_refused():
    with pytest.raises(RuntimeError, match="at least 32"):
        fernet_from_secret("too-short", "voiceprint")
