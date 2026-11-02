"""Data-policy guard: real meeting content never reaches a provider that may train on it."""

from typing import Literal

from .config import ProviderConfig

DataClass = Literal["meeting", "test"]


class DataPolicyError(RuntimeError):
    """No provider in the chain is allowed to receive this data."""


def allowed(provider: ProviderConfig, data_class: DataClass, allow_test_only: bool = False) -> bool:
    """Meeting data only goes to providers with trains_on_data: false.

    `allow_test_only` is the explicit Settings opt-in (off by default) for using
    test-only providers with meeting data.
    """
    if data_class == "test":
        return True
    if provider.trains_on_data is False:
        return True
    return allow_test_only
