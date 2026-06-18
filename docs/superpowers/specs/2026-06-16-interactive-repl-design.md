# Interactive REPL Design

Date: 2026-06-16

## Goal

Add a project-development oriented interactive shell to Code Agent while keeping the existing runtime, providers, tools, permissions, sessions, and Docker sandbox intact.

## Recommended Approach

Use a lightweight Node `readline/promises` REPL as the default no-argument entrypoint. This keeps the interface compatible with PowerShell, Windows Terminal, Docker, SSH, and basic terminals. The REPL should feel similar to Rust `claw` and Codex CLI usage, but the core behavior remains runtime-driven instead of UI-framework-driven.

## User Experience

When the user runs:

```powershell
node dist/src/index.js
```

the CLI starts an interactive prompt with:

- an ASCII banner and status panel;
- `>` prompt for natural language turns;
- slash commands for local control;
- persisted sessions under `.code-agent/sessions`;
- clear error messages without exiting the process unless the user chooses `/exit`.

## Slash Commands

The first implementation supports:

- `/help`: show interactive command help.
- `/status`: show provider, model, permission mode, workspace, and session status.
- `/model [name]`: show or switch model.
- `/provider [name]`: show or switch provider between `openai-compatible` and `anthropic`.
- `/permissions [mode]`: show or switch permission mode.
- `/session`: show current session summary.
- `/sessions`: list persisted sessions.
- `/resume <id>`: resume an existing session.
- `/compact [keep]`: compress context while keeping the latest turns.
- `/compress [keep]`: alias for `/compact`.
- `/clear`: clear the terminal screen.
- `/exit` and `/quit`: exit the REPL.

## Context Compression

Context compression is implemented at the session layer. It should not simply delete history. The operation:

1. loads or creates the active session;
2. keeps the newest N messages, defaulting to six;
3. summarizes older text, tool results, and usage into one assistant message;
4. replaces the session message list with the summary plus the retained messages;
5. saves the session immediately.

This keeps future turns aware of old work without carrying every raw message forever.

## Components

- `src/cli/banner.ts`: banner, status panel, and compact formatting helpers.
- `src/cli/slash.ts`: slash command parser and command help metadata.
- `src/cli/repl.ts`: interactive loop that dispatches slash commands or prompt turns.
- `src/core/context.ts`: context compression logic.
- Existing `AgentRuntime`: remains the runtime boundary used by both command CLI and REPL.
- Existing `SessionStore`: gains lightweight session replacement support needed by compression.

## Error Handling

Slash command errors are printed inline and the REPL continues. Prompt/runtime errors are also reported inline. Invalid provider, model, permission, and resume values should not corrupt the current runtime state.

## Testing

Add unit tests for:

- slash command parsing;
- context compression behavior;
- no-argument CLI action parsing.

Existing runtime and permission tests must continue to pass.
