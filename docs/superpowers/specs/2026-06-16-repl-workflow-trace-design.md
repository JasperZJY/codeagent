# REPL Workflow Trace UI Design

Date: 2026-06-16

## Selected Direction

Use option B: a Codex-style workflow process view for the terminal REPL.

## Goal

Make the interactive shell feel closer to the provided screenshots:

- user input is shown as a gray command box;
- each turn shows auditable process lines before the final answer;
- process lines use `Running` and `Ran` wording for commands and tools;
- the bottom status line shows the active model and workspace;
- model answers should no longer appear as a sudden uncontextualized block.

## Non-Goal

The UI must not expose hidden model chain-of-thought. The process view shows only observable runtime events:

- route analysis;
- inferred tool inputs;
- tool execution names, paths, status, and duration;
- LLM call start/end status;
- session save status;
- final answer source.

## Components

- `src/core/types.ts`: add `RuntimeTraceEvent`.
- `src/core/runtime.ts`: collect route, tool, LLM, and save trace events in `TurnSummary`.
- `src/cli/trace.ts`: render Codex-style command box, status line, and workflow trace.
- `src/cli/repl.ts`: use trace rendering for interactive turns.
- `src/cli/render.ts`: keep command-mode output stable while supporting trace-aware summaries.

## UX Shape

For a prompt such as `帮我读取 README.md`, the REPL should show:

```text
╭────────────────────────────────────────────────────────────╮
│ › 帮我读取 README.md                                       │
╰────────────────────────────────────────────────────────────╯

• Running route "帮我读取 README.md"
• Ran route -> tool:read_file
• Running read_file {"path":"README.md"}
• Ran read_file ok 12ms
• Running llm qwen3:8b
• Ran llm ok
• Saved session <id>

<assistant answer>

qwen3:8b  E:\...\code agent
```

## Testing

Add focused tests for trace rendering and runtime trace collection. Existing CLI, router, permission, and runtime tests must keep passing.
