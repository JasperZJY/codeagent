# Code Agent Design

## Goal

Build a production-oriented TypeScript agent harness inspired by the Rust `claw` runtime architecture:

1. Parse CLI input into explicit actions.
2. Load config and workspace context.
3. Route prompts to commands and tools.
4. Run a bounded turn loop.
5. Enforce permission and workspace path boundaries before tool execution.
6. Persist sessions as durable JSON records.
7. Support hosted and local model providers. Ollama `qwen3:8b` is only the no-key local default.
8. Provide a small Python bridge for optional local LLM/tool experiments without making Python the main runtime.

This is not a learning demo. The implementation should be maintainable project code with typed boundaries, tests, and clear operational docs.

## Rust-Inspired Architecture

The design borrows the shape of the Rust code without translating it line by line.

- `src/index.ts`: CLI entrypoint, equivalent to Rust `run()` dispatch.
- `src/cli/args.ts`: argument parsing into typed actions, equivalent to `CliAction`.
- `src/core/runtime.ts`: conversation and tool loop, equivalent to `ConversationRuntime`.
- `src/core/session.ts`: session lifecycle and persistence, equivalent to `Session`.
- `src/core/permissions.ts`: permission modes and authorization decisions.
- `src/core/pathScope.ts`: workspace boundary validation for file and shell tools.
- `src/tools/registry.ts`: tool catalog and execution dispatcher.
- `src/core/router.ts`: command/tool matching for prompt routing.
- `py/agent_bridge.py`: optional Python bridge using local Ollama-compatible settings.

## Permission Model

Permission modes:

- `read-only`: list, read, glob, grep, route, summary.
- `workspace-write`: read plus write/edit inside workspace.
- `danger-full-access`: all registered tools, including shell.

All file paths are resolved against the workspace root. The path scope validator denies parent escapes, absolute paths outside the workspace, and symlink escapes.

## Tool Surface

Initial tools:

- `read_file`
- `write_file`
- `edit_file`
- `list_dir`
- `glob_search`
- `grep_search`
- `shell`
- `structured_output`

The registry exposes metadata for routing, help, and permission checks. Tool execution returns structured success/error payloads so CLI JSON output stays machine-readable.

## CLI Surface

Initial commands:

- `summary`
- `manifest`
- `commands`
- `tools`
- `route <prompt>`
- `bootstrap <prompt>`
- `turn-loop <prompt>`
- `prompt <prompt>`
- `exec-tool <name> <json>`
- `session list`
- `session load <id>`
- `doctor`

Global flags:

- `--cwd <path>`
- `--model <model>`
- `--output-format text|json|markdown`
- `--permission-mode read-only|workspace-write|danger-full-access`
- `--max-turns <number>`
- `--session <id>`

## Local Model Defaults

The TypeScript runtime can call OpenAI-compatible chat completions through:

- `CODE_AGENT_PROVIDER=openai-compatible`
- `CODE_AGENT_BASE_URL`, default `http://localhost:11434/v1`
- `CODE_AGENT_API_KEY`, default `ollama`
- `CODE_AGENT_MODEL`, default `qwen3:8b`

It can also call Anthropic through:

- `CODE_AGENT_PROVIDER=anthropic`
- `ANTHROPIC_API_KEY`
- `ANTHROPIC_MODEL`

The Python bridge uses the same defaults. If the model endpoint is unavailable, CLI functions that do not require an LLM still work.

## Verification

Primary checks:

- `npm run typecheck`
- `npm test`
- `python -m py_compile py/agent_bridge.py`

Tests cover routing, path scope, permissions, sessions, and runtime turn behavior.
