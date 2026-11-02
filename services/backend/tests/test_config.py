from pathlib import Path

import yaml

CONFIG = Path(__file__).resolve().parents[3] / "config" / "providers.yaml"


def test_providers_config_loads() -> None:
    cfg = yaml.safe_load(CONFIG.read_text())
    assert set(cfg) >= {"tasks", "timeouts_s", "providers"}
    for task, chain in cfg["tasks"].items():
        assert chain, f"task {task} has no providers"
        for entry in chain:
            provider = entry.split("/", 1)[0]
            assert provider in cfg["providers"], f"{entry} uses unknown provider"


def test_every_llm_provider_declares_data_policy() -> None:
    cfg = yaml.safe_load(CONFIG.read_text())
    for name, p in cfg["providers"].items():
        if "base_url" in p:
            assert "trains_on_data" in p, f"{name} must declare trains_on_data"
