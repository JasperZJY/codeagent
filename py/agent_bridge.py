from __future__ import annotations

import argparse
import json
import os
import sys
import urllib.error
import urllib.request
from dataclasses import asdict, dataclass
from typing import Any


@dataclass(frozen=True)
class BridgeConfig:
    provider: str
    base_url: str
    api_key: str
    model: str
    timeout: float


@dataclass(frozen=True)
class BridgeResult:
    ok: bool
    model: str
    content: str
    error: str | None = None


def load_config() -> BridgeConfig:
    provider = os.getenv("CODE_AGENT_PROVIDER")
    if not provider:
        provider = "anthropic" if os.getenv("ANTHROPIC_API_KEY") else "openai-compatible"
    provider = "anthropic" if provider.lower() in {"anthropic", "claude"} else "openai-compatible"
    if provider == "anthropic":
        return BridgeConfig(
            provider=provider,
            base_url=os.getenv("CODE_AGENT_BASE_URL", os.getenv("ANTHROPIC_BASE_URL", "https://api.anthropic.com")).rstrip("/"),
            api_key=os.getenv("CODE_AGENT_API_KEY", os.getenv("ANTHROPIC_API_KEY", os.getenv("ANTHROPIC_AUTH_TOKEN", ""))),
            model=os.getenv("CODE_AGENT_MODEL", os.getenv("ANTHROPIC_MODEL", "claude-sonnet-4-6")),
            timeout=float(os.getenv("CODE_AGENT_BRIDGE_TIMEOUT", "30")),
        )
    return BridgeConfig(
        provider=provider,
        base_url=os.getenv(
            "CODE_AGENT_BASE_URL",
            os.getenv("OPENAI_BASE_URL", os.getenv("OLLAMA_BASE_URL", "http://localhost:11434/v1")),
        ).rstrip("/"),
        api_key=os.getenv(
            "CODE_AGENT_API_KEY",
            os.getenv("OPENAI_API_KEY", os.getenv("OLLAMA_API_KEY", "ollama")),
        ),
        model=os.getenv(
            "CODE_AGENT_MODEL",
            os.getenv("OPENAI_MODEL", os.getenv("OLLAMA_MODEL", "qwen3:8b")),
        ),
        timeout=float(os.getenv("CODE_AGENT_BRIDGE_TIMEOUT", "30")),
    )


def chat(prompt: str, system: str | None = None) -> BridgeResult:
    config = load_config()
    if config.provider == "anthropic":
        return anthropic_chat(config, prompt, system)
    return openai_compatible_chat(config, prompt, system)


def openai_compatible_chat(config: BridgeConfig, prompt: str, system: str | None = None) -> BridgeResult:
    messages: list[dict[str, str]] = []
    if system:
        messages.append({"role": "system", "content": system})
    messages.append({"role": "user", "content": prompt})
    payload = {
        "model": config.model,
        "temperature": 0,
        "messages": messages,
    }
    request = urllib.request.Request(
        f"{config.base_url}/chat/completions",
        data=json.dumps(payload).encode("utf-8"),
        headers={
            "content-type": "application/json",
            "authorization": f"Bearer {config.api_key}",
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=config.timeout) as response:
            body = json.loads(response.read().decode("utf-8"))
        content = (
            body.get("choices", [{}])[0]
            .get("message", {})
            .get("content", "")
            .strip()
        )
        return BridgeResult(ok=True, model=config.model, content=content)
    except (urllib.error.URLError, TimeoutError, json.JSONDecodeError, KeyError, IndexError) as exc:
        return BridgeResult(
            ok=False,
            model=config.model,
            content="",
            error=f"{type(exc).__name__}: {exc}",
        )


def anthropic_chat(config: BridgeConfig, prompt: str, system: str | None = None) -> BridgeResult:
    payload = {
        "model": config.model,
        "max_tokens": 2048,
        "temperature": 0,
        "system": system or "",
        "messages": [{"role": "user", "content": prompt}],
    }
    headers = {
        "content-type": "application/json",
        "anthropic-version": "2023-06-01",
    }
    if os.getenv("ANTHROPIC_AUTH_TOKEN") and not os.getenv("ANTHROPIC_API_KEY"):
        headers["authorization"] = f"Bearer {config.api_key}"
    else:
        headers["x-api-key"] = config.api_key
    request = urllib.request.Request(
        f"{config.base_url}/v1/messages",
        data=json.dumps(payload).encode("utf-8"),
        headers=headers,
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=config.timeout) as response:
            body = json.loads(response.read().decode("utf-8"))
        content = "".join(block.get("text", "") for block in body.get("content", [])).strip()
        return BridgeResult(ok=True, model=config.model, content=content)
    except (urllib.error.URLError, TimeoutError, json.JSONDecodeError, KeyError, IndexError) as exc:
        return BridgeResult(
            ok=False,
            model=config.model,
            content="",
            error=f"{type(exc).__name__}: {exc}",
        )


def health() -> dict[str, Any]:
    config = load_config()
    return {
        "ok": True,
        "provider": config.provider,
        "base_url": config.base_url,
        "model": config.model,
        "api_key": "set" if config.api_key else "unset",
        "python": sys.version.split()[0],
    }


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Python bridge for code-agent local LLM calls")
    subparsers = parser.add_subparsers(dest="command", required=True)

    chat_parser = subparsers.add_parser("chat")
    chat_parser.add_argument("prompt")
    chat_parser.add_argument("--system")

    subparsers.add_parser("health")

    args = parser.parse_args(argv)
    if args.command == "health":
        print(json.dumps(health(), ensure_ascii=False, indent=2))
        return 0
    if args.command == "chat":
        result = chat(args.prompt, args.system)
        print(json.dumps(asdict(result), ensure_ascii=False, indent=2))
        return 0 if result.ok else 1
    parser.error(f"unknown command: {args.command}")
    return 2


if __name__ == "__main__":
    raise SystemExit(main())
