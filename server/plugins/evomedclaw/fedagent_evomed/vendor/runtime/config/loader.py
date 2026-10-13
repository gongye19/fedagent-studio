"""Load EvoMed runtime configuration without repo-root coupling."""

from __future__ import annotations

import os
from copy import deepcopy
from pathlib import Path
from typing import Any, Dict, Mapping, Optional

from importlib.resources import files

import yaml


def _load_yaml(path: Path) -> Dict[str, Any]:
    if not path.exists():
        return {}
    payload = yaml.safe_load(path.read_text(encoding="utf-8")) or {}
    return payload if isinstance(payload, dict) else {}


def _merge_dicts(base: Dict[str, Any], override: Mapping[str, Any]) -> Dict[str, Any]:
    merged = deepcopy(base)
    for key, value in override.items():
        if isinstance(value, dict) and isinstance(merged.get(key), dict):
            merged[key] = _merge_dicts(dict(merged[key]), value)
        else:
            merged[key] = value
    return merged


def resolve_prompts_root() -> Path:
    candidate = files("fedagent_evomed.vendor.runtime").joinpath("prompts")
    return Path(str(candidate))


def provider_for_model(model_name: str, config: Optional[Mapping[str, Any]] = None) -> str:
    lowered = model_name.lower()
    if lowered.startswith("deepseek"):
        return "deepseek"
    if lowered.startswith("claude"):
        anthropic_cfg = ((config or {}).get("providers") or {}).get("anthropic") or {}
        return "anthropic" if anthropic_cfg.get("base_url") else "openai"
    if "kimi" in lowered or "moonshot" in lowered:
        return "kimi"
    return "openai"


def load_runtime_config(
    explicit_path: Optional[Path | str] = None,
    cwd: Optional[Path | str] = None,
    env: Optional[Mapping[str, str]] = None,
    user_config_path: Optional[Path | str] = None,
) -> Dict[str, Any]:
    env_map = dict(env or os.environ)
    cwd_path = Path(cwd or os.getcwd())

    defaults_path = Path(str(files("fedagent_evomed.vendor.runtime.config").joinpath("defaults.yaml")))
    config = _load_yaml(defaults_path)

    project_override = cwd_path / "fedagent_evomed.vendor.local.yaml"
    if project_override.exists():
        config = _merge_dicts(config, _load_yaml(project_override))

    resolved_user_path = (
        Path(user_config_path)
        if user_config_path is not None
        else Path.home() / ".config" / "evomed" / "config.yaml"
    )
    if resolved_user_path.exists():
        config = _merge_dicts(config, _load_yaml(resolved_user_path))

    env_override_raw = env_map.get("EVOMED_CONFIG", "").strip()
    if env_override_raw:
        env_override = Path(env_override_raw)
        if env_override.exists():
            config = _merge_dicts(config, _load_yaml(env_override))

    if explicit_path is not None:
        explicit = Path(explicit_path)
        if explicit.exists():
            config = _merge_dicts(config, _load_yaml(explicit))

    return config


def resolve_provider_config(
    model_name: str,
    config: Optional[Mapping[str, Any]] = None,
    *,
    env: Optional[Mapping[str, str]] = None,
) -> Dict[str, str]:
    runtime_config = dict(config or load_runtime_config(env=env))
    provider = provider_for_model(model_name, runtime_config)
    api_key = str((runtime_config.get("api_keys") or {}).get(provider, "")).strip()
    provider_cfg = (runtime_config.get("providers") or {}).get(provider, {}) or {}
    base_url = str(provider_cfg.get("base_url", "")).strip().rstrip("/")
    if base_url and not base_url.endswith("/v1"):
        base_url = f"{base_url}/v1"

    if not api_key:
        env_map = {
            "openai": "OPENAI_API_KEY",
            "deepseek": "DEEPSEEK_API_KEY",
            "anthropic": "ANTHROPIC_API_KEY",
            "kimi": "KIMI_API_KEY",
        }
        api_key = str((env or os.environ).get(env_map.get(provider, ""), "")).strip()

    return {
        "provider": provider,
        "api_key": api_key,
        "base_url": base_url,
    }


def write_default_user_config(path: Optional[Path | str] = None, *, force: bool = False) -> Path:
    target = (
        Path(path)
        if path is not None
        else Path.home() / ".config" / "evomed" / "config.yaml"
    )
    if target.exists() and not force:
        return target
    target.parent.mkdir(parents=True, exist_ok=True)
    defaults = load_runtime_config(cwd=target.parent, env={})
    target.write_text(yaml.safe_dump(defaults, sort_keys=False, allow_unicode=True), encoding="utf-8")
    return target
