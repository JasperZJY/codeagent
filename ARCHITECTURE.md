# Architecture

## Layers

The project follows the runtime split used by the Rust codebase while keeping the implementation compact:

- CLI parsing: `src/cli/args.ts`
- Interactive REPL: `src/cli/repl.ts`, `src/cli/slash.ts`, `src/cli/slashMenu.ts`, `src/cli/banner.ts`
- Rendering: `src/cli/render.ts`, `src/cli/trace.ts`, `src/cli/markdownRenderer.ts`, `src/cli/terminalBlocks.ts`
- Copy/clipboard helpers: `src/cli/copyManager.ts`, `src/cli/clipboard.ts`
- Config and provider resolution: `src/core/config.ts`
- Routing: `src/core/router.ts`
- Sessions and context compression: `src/core/session.ts`, `src/core/context.ts`, `src/core/headroom.ts`
- Project intelligence loops: `src/core/goals.ts`, `src/core/reflection.ts`, `src/core/reflectionPolicy.ts`, `src/core/memory.ts`, `src/core/recovery.ts`, `src/core/rag.ts`, `src/core/skills.ts`
- Python execution loop: `src/core/pythonRunner.ts`
- Plan/Todo and validation: `src/core/tasks.ts`, `src/core/projectDetector.ts`, `src/core/commandProfile.ts`, `src/core/errorParser.ts`, `src/core/testRunner.ts`
- Summary policy: `src/core/summaryPolicy.ts`
- Code intelligence and recovery state: `src/core/symbolIndex.ts`, `src/core/codeAnalyzer.ts`, `src/core/projectInit.ts`, `src/core/contextMonitor.ts`, `src/core/resumeState.ts`
- Permissions, path scope, and safety: `src/core/permissions.ts`, `src/core/pathScope.ts`, `src/core/security.ts`
- Change checkpoints: `src/core/changeTracker.ts`
- Runtime loop: `src/core/runtime.ts`
- Tool registry and implementations: `src/tools/registry.ts`, `src/tools/fileTools.ts`, `src/tools/gitTools.ts`, `src/tools/pythonTools.ts`, `src/tools/skillTools.ts`, `src/tools/taskTools.ts`, `src/tools/projectTools.ts`, `src/tools/testTools.ts`, `src/tools/codeIntelTools.ts`, `src/tools/initTools.ts`, `src/tools/contextMonitorTools.ts`
- MCP stdio server: `src/mcp/server.ts`
- Optional Python provider bridge: `py/agent_bridge.py`

## Runtime Flow

1. Parse global flags and subcommand into a typed CLI action.
2. Load `.env`, `.code-agent.json`, `.code-agent/settings.json`, and explicit overrides.
3. Build `AgentRuntime` with workspace root, provider, model, permissions, and output format.
4. Append the user message to the session.
5. Route the prompt to command/tool candidates.
6. Load relevant durable memory, local RAG snippets, and any explicitly matching skill workflows, then create active goals for the turn.
7. If the request is complex or an unfinished plan exists, create or resume a persisted Plan/Todo file under `.code-agent/tasks/`.
8. When LLM use is enabled, run a coordinator prompt to classify the request and choose a workflow strategy.
9. Create a per-turn checkpoint, run a planner prompt that returns JSON tool actions, execute those tools, append tool results, recover from common failures, and repeat until the planner finishes or goals are met.
10. Before shell execution, classify command risk. Before file mutation, record the file's pre-write state in the active checkpoint. After mutation, record the post-write hash.
11. After file mutation, infer the project command profile and run available validation commands through the existing `shell` tool. Failed output is parsed into structured errors; with LLM enabled, the planner can attempt repairs and retry validation up to 3 times.
12. Ask `reflectionPolicy` whether the turn needs no, light, or full reflection. Simple read/list/search turns skip reflection; code changes, validation, failures, risky work, or explicit review requests run the reviewer and can write durable memory lessons.
13. Build a context monitor report for the active session, including estimated active tokens, tool-result ratio, compression state, CCR cache count, and approximate cost metadata.
14. Generate final assistant text through the configured provider; provider usage is recorded when available, otherwise per-turn usage is estimated and marked as estimated.
15. Decide final summary visibility through `src/core/summaryPolicy.ts`: simple turns skip the large template, while edits, tests, failures, Plan/Todo, Python, and Git/change operations get a brief or full summary according to config.
16. Save the session under `.code-agent/sessions`.

## Interactive Flow

Running `code-agent` without a command starts the interactive REPL. Real TTY sessions use `src/cli/terminalUi.ts` for a Codex CLI-style screen with scrollback above and a fixed composer at the bottom unless `terminalMode=scrollback` is selected. Non-TTY sessions and scrollback mode use line mode so scripts, pipes, and native terminal selection remain stable. Slash commands are handled locally by `src/cli/repl.ts`; normal text input is passed to `AgentRuntime.runTurn`.

The REPL is a thin shell around the runtime. It does not duplicate routing, tool execution, provider calls, session persistence, or permission checks.

Supported interactive commands include `/help`, `/status`, `/model`, `/profile`, `/provider`, `/permissions`, `/session`, `/sessions`, `/resume`, `/compact`, `/verbose`, `/markdown`, `/dialog-blocks`, `/summary`, `/terminal-mode`, `/copy`, `/transcript`, `/diff`, `/changes`, `/checkpoint`, `/revert`, `/commit-msg`, `/risk`, `/python`, `/skills`, `/plan`, `/todo`, `/task`, `/resume-task`, `/init`, `/context`, `/tokens`, `/cost`, `/clear`, and `/exit`.

When the user types `/` in TTY mode, `src/cli/slashMenu.ts` provides a multi-level command menu. The REPL owns only menu navigation state: Up/Down select, Enter enters a submenu or fills a command, Tab completes, Backspace returns to the parent menu, and Esc closes the menu. The filled command still goes through the normal slash parser and runtime permission path.

Project intelligence commands include `/goals`, `/memory [query]`, `/rag index [path]`, and `/rag search <query>`.

Plan/Todo commands include `/plan`, `/todo`, `/task add <content>`, `/task done <id>`, `/task block <id>`, `/task reset`, and `/resume-task`.

Project initialization and context commands include `/init`, `/context`, `/tokens`, and `/cost`. `/resume <id>` restores the selected session and also renders the recoverable state collected by `src/core/resumeState.ts`.

Interactive prompt turns use `src/cli/trace.ts` to render live tool progress, the final assistant answer, and a model/workspace footer. `AgentRuntime.runTurn` accepts an optional `onTrace` callback so the TTY REPL can print observable runtime progress immediately while still returning the full trace in `TurnSummary`.

User prompts and final assistant answers render through `src/cli/terminalBlocks.ts` as separate `You` and `Agent` blocks. Tool calls, diffs, tests, and trace summaries stay outside the Agent block so the conversation and execution trail remain visually distinct.

Normal completion summaries are now policy-driven. `summary=auto` skips the large template for simple answers and simple read/list turns, but shows a brief summary for file edits, validation, failures, Plan/Todo, Python execution, and Git/change operations. `summary=always` restores the full template; `summary=off` suppresses summaries. The summary is derived from `TurnSummary` fields and tool observations only; it does not print hidden planner prompts or private model reasoning.

Each turn can render a token usage footer from `TurnSummary.turnUsage`. Provider-reported usage is marked as API sourced; missing usage is estimated by local heuristics and displayed with `~` plus `estimated`. JSON output keeps the usage fields without ANSI.

Provider thinking is modeled as observable stream metadata. `src/core/llm.ts` recognizes OpenAI-compatible `reasoning_content`, `reasoning`, `thinking.content`, and Qwen-style `<think>...</think>` content, removes those bytes from user-visible assistant text, and emits a folded `thinking` trace event. `thinkingDisplay=summary` shows only a status line, `off` hides it, and `verbose` shows source plus character count. Hidden reasoning text is not rendered in normal output.

`src/cli/copyManager.ts` and `src/cli/clipboard.ts` solve the native mouse-selection limitation of self-painted TUI sessions. `/copy last|turn|all|transcript|save` extracts plain text with ANSI and box decorations removed, then uses platform clipboard commands or saves to `.code-agent/transcripts/copy-*.txt`.

Trace rendering has two modes. Normal mode hides internal route/coordinator/planner/reflection/memory/RAG/save events and renders concise user-facing summaries such as file reads, searches, shell command results, and edit diffs. Verbose mode is enabled by `--verbose`, `CODE_AGENT_VERBOSE=1`, or `/verbose on` and renders the detailed debug trace.

`src/cli/compact.ts` compresses long terminal output while preserving errors, paths, line numbers, and diff hunks. `src/cli/transcript.ts` keeps the full uncompressed turn transcript in memory for `/transcript`, `/transcript all`, Ctrl+T, and `.code-agent/transcripts/` saves.

`src/cli/markdownRenderer.ts` is the terminal-only Markdown presentation layer. It parses common Markdown forms into ANSI terminal output for final assistant answers and user-facing completion summaries. It is enabled only for TTY normal output when `markdown` is not disabled. JSON output, non-TTY output, verbose debug trace, tool stdout/stderr, and diffs stay raw so machine-readable and audit logs remain stable.

The fixed-bottom TTY UI treats ANSI escape sequences as zero-width while wrapping history lines. This lets colored Markdown headings, inline code, and code-block borders render without moving or corrupting the composer.

Trace output is intentionally limited to auditable events and tool observations. It is not hidden model chain-of-thought, planner prompts, system prompts, or model-private reasoning.

The TTY UI follows the same broad shape as the Rust `claw-code` CLI: stable prompt input, visible `Working` status for long model phases, streaming assistant text, compact tool progress, and full session preservation. OpenAI-compatible providers stream through SSE when the REPL supplies `onTextDelta`.

Write/create/save prompts are handled through the same model-driven tool loop as other tasks. The model planner must emit a `write_file` action with complete content. With LLM use disabled, the runtime does not fabricate generated code.

## Context Compression

`/compact [keep]` summarizes older messages into one assistant summary message, keeps the newest N messages, recalculates active context usage, and saves the session immediately. This prevents large sessions from growing indefinitely while preserving prior project context.

`src/core/headroom.ts` adds a Headroom-inspired CCR layer for model calls. Large tool results are summarized before they reach the LLM, while the original output is cached under `.code-agent/ccr` and remains retrievable through `ccr_retrieve`. The `headroom` compression mode is reserved for deployments where an external Headroom proxy handles compression.

## MCP And Web Tools

`codeagent mcp-server` starts a stdio MCP server that exposes registered tools through `tools/list` and `tools/call`.

Network tools are normal registry tools:

- `fetch_url`: fetch a specific URL.
- `web_search`: search through a configured provider, currently Baidu AI Search via `BAIDU_AI_SEARCH_API_KEY`.

The model can call these tools through the coordinator/planner loop when the prompt requires internet access.

## Project Intelligence

The runtime implements the following aaagge-inspired control loops:

- Goal setting / observation loop: `src/core/goals.ts` derives turn goals and updates them from tool results.
- Plan/Todo execution loop: `src/core/tasks.ts` creates persisted task plans for complex work, records reason/evidence per task, advances statuses from tool observations, and resumes unfinished plans.
- Selective reflection loop: `src/core/reflectionPolicy.ts` decides whether reflection is skipped, light, or full; `src/core/reflection.ts` reviews tool observations and goals only when the policy requires it.
- Memory learning: `src/core/memory.ts` persists preferences, project facts, failures, successes, and lessons in JSONL.
- Exception recovery: `src/core/recovery.ts` maps common failures to fallback tool actions.
- RAG: `src/core/rag.ts` builds and searches a local keyword index for workspace text files.
- Code symbol intelligence: `src/core/symbolIndex.ts` indexes TypeScript/JavaScript symbols with the TypeScript Compiler API, adds a lightweight Python parser, and persists `.code-agent/symbols/index.json`.
- Skills: `src/core/skills.ts` loads reusable workflow packages from `src/skills/builtin/` and `.code-agent/skills/`. Skills are instructions and tool preferences, not permissions; tool execution still flows through `src/tools/registry.ts`.
- Python execution: `src/core/pythonRunner.ts` writes temp scripts under `.code-agent/tmp/`, runs workspace-bound Python with timeout/risk checks, stores the latest structured result, and lets `src/tools/pythonTools.ts` expose the loop through registry/MCP/REPL.

RAG and symbol intelligence are intentionally separate. RAG answers natural-language retrieval questions over text chunks. Symbol intelligence answers code-structure questions such as "where is this function defined?", "what references this class?", "what does this file import?", and "what calls this method?".

The code intelligence tool layer exposes:

- `symbol_index`
- `symbol_search`
- `find_definition`
- `find_references`
- `analyze_imports`
- `call_graph`
- `code_outline`

`src/core/projectInit.ts` uses project command detection plus the symbol index to create `.code-agent/project.md`, `.code-agent/rules.md`, and `.code-agent/commands.md`. `src/core/resumeState.ts` combines session history, goals, task state, checkpoint summaries, commands, validation status, blocked reasons, and next-step hints. `src/core/contextMonitor.ts` reports current session context pressure, tool-result ratio, compression status, CCR cache entries, and local/remote cost estimates.

Project command detection is split from the runtime:

- `src/core/projectDetector.ts` identifies Node, Python, Make, Rust, and Maven projects from standard files.
- `src/core/commandProfile.ts` converts detections into `typecheck`, `test`, `lint`, `build`, and `dev` commands and persists `.code-agent/project-profile.json`.
- `src/core/errorParser.ts` extracts structured file, line, type, and message entries from TypeScript, npm/node test, and Python logs.
- `src/core/testRunner.ts` owns the Test-Fix Loop contract: run validation, parse failures, call an optional repair callback, retry up to 3 times, and return `passed`, `warning`, `blocked`, or `failed`.

The runtime only orchestrates these modules. It does not hardcode project-specific commands or parse compiler output inline.

These loops deliberately expose only observable summaries and tool observations. They do not display hidden chain-of-thought.

## Provider Strategy

Two wire protocols are first-class:

- `openai-compatible`: `/chat/completions` with Bearer auth.
- `anthropic`: `/v1/messages` with `x-api-key` or Bearer auth when `ANTHROPIC_AUTH_TOKEN` is used.

Provider routing is intentionally separate from model names. This avoids coupling the runtime to one vendor and keeps local models, gateways, and hosted APIs interchangeable.

`src/core/config.ts` also supports named provider profiles loaded from `.code-agent.json` or `.code-agent/settings.json`. Profiles can define `provider`, `baseUrl`, `model`, `apiKey`, `apiKeyEnv`, and `useLlm`. `apiKeyEnv` lets paid-provider secrets stay in environment variables while the project config stores only the variable name. The REPL `/profile <name>` command rebuilds `AgentRuntime` with the selected profile and the current session id, so model/provider switching does not drop conversation context.

## Safety Strategy

Permission mode decides which tools can run. Workspace scope decides where file and shell path operands can point. These checks are independent:

- A tool can be denied because the active permission mode is too low.
- A tool can be denied because a path resolves outside the workspace.
- `danger-full-access` allows shell execution, but path operands are still workspace checked.

`src/core/security.ts` adds a second safety layer that is independent of permission mode:

- shell commands are categorized as `safe`, `write`, `network`, `destructive`, `credential-risk`, or `system-risk`;
- destructive and credential-risk commands are blocked before execution;
- sensitive paths such as `.env`, SSH keys, cookies, and credential stores are not read by default;
- tool inputs, tool outputs, session messages, memory entries, RAG chunks, and CCR cache payloads are redacted before persistence.

`src/core/changeTracker.ts` provides the rollback boundary. Runtime turns create checkpoints automatically, while `write_file` and `edit_file` record before/after hashes through the registry. Revert only restores files whose current hash still matches the agent-written hash, so user edits made after the agent write are skipped.

`src/tools/gitTools.ts` keeps Git concerns out of the runtime. It exposes status, diff, commit-message drafting, checkpoint creation, change summaries, reverts, and command-risk analysis as normal tools, so MCP and the planner use the same safety path as the CLI slash commands.
