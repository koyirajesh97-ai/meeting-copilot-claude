"""Provider router. Feature code calls `complete(...)`; never a provider SDK directly."""

from .client import CompletionClient, FakeClient, LiteLLMClient, ProviderError, ProviderResponse
from .config import Deployment, RouterConfig, load_config
from .policy import DataClass, DataPolicyError
from .quota import InMemoryQuotaStore, QuotaStore, QuotaTracker
from .router import (
    Completion,
    NoProviderAvailable,
    ProviderSwitched,
    QuotaWarning,
    Router,
    RouterNotice,
)
from .stt import SttRegistry

__all__ = [
    "Completion",
    "CompletionClient",
    "DataClass",
    "DataPolicyError",
    "Deployment",
    "FakeClient",
    "InMemoryQuotaStore",
    "LiteLLMClient",
    "NoProviderAvailable",
    "ProviderError",
    "ProviderResponse",
    "ProviderSwitched",
    "QuotaStore",
    "QuotaTracker",
    "QuotaWarning",
    "Router",
    "RouterConfig",
    "RouterNotice",
    "SttRegistry",
    "complete",
    "load_config",
]


async def complete(task, messages, data_class, json_schema=None, **kwargs) -> Completion:
    """complete(task, messages, data_class, json_schema) on the app's shared router."""
    from app.services import services

    return await services().router.complete(task, messages, data_class, json_schema, **kwargs)
