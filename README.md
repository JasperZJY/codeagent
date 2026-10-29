# Code Agent

Production-oriented TypeScript agent harness inspired by the Rust `claw` runtime and Codex-style CLI ergonomics.

## Quick Start

```powershell
npm install
npm run build
node dist/src/index.js
node dist/src/index.js doctor
node dist/src/index.js summary
node dist/src/index.js route "read README.md"
node dist/src/index.js prompt "read README.md"
```

Running without a command starts the interactive shell.

To install the local CLI globally during development:

```powershell
npm run link:global
codeagent
```

Both `codeagent` and `code-agent` are registered.

## Docker Sandbox

Docker sandbox files are included:

- `Dockerfile`
- `docker-compose.yml`
- `.dockerignore`
- `docs/sandbox.md`

Run:

```powershell
docker compose build
docker compose run --rm code-agent npm test
docker compose run --rm code-agent node dist/src/index.js doctor
docker compose run --rm code-agent
```

Inside Docker Desktop, host Ollama should usually be reached through:

```env
CODE_AGENT_BASE_URL=http://host.docker.internal:11434/v1
```

## Provider Configuration

The runtime is not tied to Ollama. Ollama is only the local default because it works without a paid API key.

### Generic Variables

```env
CODE_AGENT_PROVIDER=openai-compatible
CODE_AGENT_BASE_URL=http://localhost:11434/v1
CODE_AGENT_API_KEY=ollama
CODE_AGENT_MODEL=qwen3:8b
CODE_AGENT_PROFILE=ollama
CODE_AGENT_CONTEXT_COMPRESSION=local
CODE_AGENT_VERBOSE=0
CODE_AGENT_MARKDOWN=1
CODE_AGENT_DIALOG_BLOCKS=1
CODE_AGENT_SHOW_TOKEN_USAGE=1
CODE_AGENT_SUMMARY_MODE=auto
CODE_AGENT_TERMINAL_MODE=tui
CODE_AGENT_THINKING_DISPLAY=off
CODE_AGENT_LLM_TIMEOUT_MS=300000
```

### Provider Profiles

Provider/model profiles can be configured in `.code-agent.json` or `.code-agent/settings.json` and switched inside the REPL without losing the active session:

```json
{
  "defaultProfile": "ollama",
  "profiles": {
    "ollama": {
      "provider": "openai-compatible",
      "baseUrl": "http://localhost:11434/v1",
      "baseUrlEnv": "OLLAMA_BASE_URL",
      "apiKeyEnv": "OLLAMA_API_KEY",
      "model": "qwen3:8b",
      "modelEnv": "OLLAMA_MODEL",
      "useLlm": true
    },
    "deepseek": {
      "provider": "openai-compatible",
      "baseUrl": "https://api.deepseek.com",
      "baseUrlEnv": "DEEPSEEK_BASE_URL",
      "apiKeyEnv": "DEEPSEEK_API_KEY",
      "model": "deepseek-v4-flash",
      "modelEnv": "DEEPSEEK_MODEL",
      "useLlm": true
    }
  },
  "llmTimeoutMs": 300000,
  "ui": {
    "dialogBlocks": true,
    "showTokenUsage": true,
    "thinkingDisplay": "off",
    "summaryMode": "auto",
    "terminalMode": "tui"
  }
}
```

Keep paid provider keys in environment variables or `.env`, not in committed config:

```powershell
$env:DEEPSEEK_API_KEY="sk-..."
```

`apiKeyEnv`, `baseUrlEnv`, and `modelEnv` work the same way: when the named variable is set it wins over the profile's `apiKey`/`baseUrl`/`model`, and when it is unset the committed default applies. That keeps machine-specific endpoints out of the repository — a fresh clone points at `localhost`, while a machine that runs Ollama on another host only needs its local, ignored `.env`:

```env
OLLAMA_BASE_URL=http://192.168.1.105:11434/v1
OLLAMA_MODEL=qwen3.6:27b
```

Switch in the REPL:

```text
/profile list
/profile deepseek
/profile ollama
/profile current
```

You can also select a profile on startup:

```powershell
codeagent --profile deepseek
```

### OpenAI-Compatible Providers

Use `CODE_AGENT_PROVIDER=openai-compatible` for OpenAI, OpenRouter, DashScope compatible mode, vLLM, llama.cpp, Ollama, and similar `/chat/completions` APIs.

DeepSeek uses the same OpenAI-compatible path. Use `baseUrl=https://api.deepseek.com` and models such as `deepseek-v4-flash` or `deepseek-v4-pro`.

```env
CODE_AGENT_PROVIDER=openai-compatible
CODE_AGENT_BASE_URL=https://api.openai.com/v1
CODE_AGENT_API_KEY=sk-...
CODE_AGENT_MODEL=gpt-4.1-mini
```

### Anthropic

```env
CODE_AGENT_PROVIDER=anthropic
ANTHROPIC_API_KEY=sk-ant-...
ANTHROPIC_MODEL=claude-sonnet-4-6
```

## Permission Modes

- `read-only`: read/list/glob/grep/exists/route/summary.
- `workspace-write`: read plus write/edit/delete/move inside the workspace.
- `danger-full-access`: all tools, including shell.

File and shell path operands are still checked against the workspace root.

## Commands

```text
interactive | repl
summary
manifest
commands [--query <text>] [--limit <n>]
tools [--query <text>] [--limit <n>]
route <prompt>
bootstrap <prompt>
turn-loop <prompt>
prompt <prompt>
exec-tool <name> <json-payload>
session list
session load <id>
mcp-server
doctor
```

`prompt`, `turn-loop`, and `bootstrap` exit non-zero when the provider call failed and the printed answer is a fallback. The fallback text is still rendered on stdout, `llmFailure` carries the reason in `--output-format json`, and `error: llm_unavailable: <reason>` goes to stderr, so scripts and CI can tell a real answer from a dead model.

## Interactive Shell

Start it with:

```powershell
node dist/src/index.js
```

Or in Docker:

```powershell
docker compose run --rm code-agent
```

Useful slash commands:

```text
/help
/status
/model [name]
/profile [list|current|name]
/provider [openai-compatible|anthropic]
/permissions [read-only|workspace-write|danger-full-access]
/session [rename|summarize|id|refresh-title]
/sessions [all|current-workspace|search]
/resume [selector]
/compact [keep]
/compress [keep]
/goals
/memory [query]
/rag index [path]
/rag search <query>
/python [run|exec|last|clean]
/skills [list|search|use|read|create|reload|init]
/verbose on|off
/markdown on|off
/dialog-blocks on|off
/thinking off|summary|verbose
/timeout [ms]
/summary auto|off|always
/terminal-mode tui|scrollback
/copy last|turn|all|transcript|save
/transcript [all|save]
/diff [path]
/changes
/checkpoint
/revert
/commit-msg
/risk <command>
/plan
/todo
/task add <content>
/task done <id>
/task block <id>
/task reset
/resume-task
/init
/context
/tokens
/cost
/clear
/exit
```

`/timeout` sets the LLM request timeout. For OpenAI-compatible streaming responses, the same value is treated as an idle timeout and refreshes whenever a stream chunk arrives.

`/compact` compresses older session messages into one summary message and keeps the latest messages. The default keep count is `6`.

In a real terminal TTY, the interactive shell uses a Codex CLI-style layout:

- the scrollback and workflow logs stay above;
- the composer/input box stays fixed at the bottom;
- user prompts render as a `You` block;
- final assistant answers render as an `Agent` block;
- Enter submits the current prompt;
- Backspace edits the composer;
- Ctrl+L clears the visible scrollback;
- Ctrl+T shows the latest full transcript output;
- Ctrl+C exits the session.

Scripted or piped input keeps plain line-mode output for automation.

Dialog blocks can be disabled with:

```powershell
codeagent --no-dialog-blocks
```

```text
/dialog-blocks on
/dialog-blocks off
```

Normal workflow trace output looks like:

```text
● Read README.md
  ⎿ 96 lines

● Ran npm run typecheck
  ⎿ Passed in 2.3s

● Edited src/cli/repl.ts (+12 -1)
  ⎿ + new line
    - old line
```

Use `--verbose`, `CODE_AGENT_VERBOSE=1`, or `/verbose on` to show the detailed debug trace with route/coordinator/planner/reflection/memory/RAG events.

Long command output, file content, search results, and diffs are compacted in the terminal. The full uncompressed transcript is retained for the current REPL session:

```text
/transcript
/transcript all
/transcript save
```

`/transcript save` writes Markdown transcripts under `.code-agent/transcripts/`.

Typing `/` in a real TTY opens a multi-level command menu above the fixed composer. Use Up/Down to select, Enter to enter a submenu or fill the selected command, Tab to complete, Backspace to return to the parent menu, and Esc to close the menu without exiting the REPL.

Each turn shows a token line by default:

```text
Tokens: input ~1,248 · output ~392 · total ~1,640 estimated · context 18%
```

When the model provider returns authoritative usage, the `~` and `estimated` marker are omitted. Local Ollama-compatible models show tokens but usually do not show cost. Controls:

```powershell
codeagent --no-token-usage
```

```text
/tokens show on
/tokens show off
```

Final summaries default to `auto`. Simple answers and simple read/list turns do not get the large final template. File edits, tests, failures, Plan/Todo, Python runs, and Git/change operations get a brief summary. Controls:

```powershell
codeagent --summary auto
codeagent --summary off
codeagent --summary always
```

```text
/summary auto
/summary off
/summary always
```

### Copy And Native Scrollback

The TUI keeps a fixed composer by repainting its own viewport, so native mouse selection may only cover the visible page in some terminals. Use the internal copy commands when you need reliable multi-page copying:

```text
/copy last          Copy the latest assistant answer.
/copy turn          Copy the latest full turn.
/copy all           Copy the visible TUI history, or transcript fallback.
/copy transcript    Copy the full transcript buffer.
/copy save          Save copy text to .code-agent/transcripts/copy-*.txt.
```

Copy output is plain text with ANSI escapes removed. On Windows it uses `Set-Clipboard`; on macOS `pbcopy`; on Linux `wl-copy` or `xclip` when available. If no clipboard command exists, use `/copy save`.

For long mouse-selection sessions, start or switch to native scrollback mode:

```powershell
codeagent --terminal-mode scrollback
```

```text
/terminal-mode scrollback
/terminal-mode tui
/thinking off
/thinking summary
/thinking verbose
```

`scrollback` uses normal terminal output instead of the self-painted TUI on the next REPL start. It is easier to select with the terminal mouse, but the fixed-bottom composer is degraded.

## Python Execution And Skills

Python execution is available through controlled workspace tools:

```text
/python run <file>    Run an existing workspace .py file.
/python exec <code>   Execute a short snippet via a temp script.
/python last          Show the latest Python execution result.
/python clean         Clean .code-agent/tmp Python temp files.
```

The registry also exposes:

```text
python_exec
python_run_file
python_write_and_run
python_analyze_result
python_last_result
python_clean_tmp
python_risk
```

Python runs are workspace-bound, default to a 30 second timeout, save temporary scripts under `.code-agent/tmp/`, return structured `ok`, `exitCode`, `stdout`, `stderr`, `durationMs`, and `summary` fields, and block sensitive paths plus network/subprocess-style code by default.

Reusable skills are workflow packages stored as `SKILL.md` files. Built-in skills include:

- `python-data-analysis`
- `project-structure-review`
- `test-fix-loop`
- `terminal-ui-polish`
- `git-change-review`

Skill commands:

```text
/skills list
/skills search <query>
/skills use <name>
/skills read <name>
/skills create <name>
/skills reload
/skills init
```

Skills do not bypass permissions. They only load reusable workflow instructions; every file read, write, command, Python run, or MCP call still goes through the normal registry permission and risk checks.

## Plan/Todo And Test-Fix Loop

Complex prompts automatically create a persisted execution plan under `.code-agent/tasks/`. Each task contains:

- `id`
- `title`
- `status`: `pending`, `running`, `done`, `blocked`, or `failed`
- `reason`
- `evidence`
- `updatedAt`

Task commands:

```text
/plan              Show the current persisted plan.
/todo              Show the same task list in todo form.
/task add <text>   Add a task to the current plan.
/task done <id>    Mark a task done.
/task block <id>   Mark a task blocked.
/task reset        Clear the current plan.
/resume-task       Resume the latest incomplete plan.
```

When a turn modifies files with `write_file` or `edit_file`, the runtime builds a project command profile from files such as `package.json`, `pyproject.toml`, `requirements.txt`, `Makefile`, `Cargo.toml`, and `pom.xml`. It infers commands for:

- `typecheck`
- `test`
- `lint`
- `build`
- `dev`

Automatic validation uses only non-interactive validation commands (`typecheck`, `lint`, `test`, `build`) and runs them through the existing `shell` tool, so permission mode, workspace boundaries, and command-risk classification still apply. If validation fails, the runtime parses TypeScript, npm/node test, and Python error logs into structured file/line/error entries. With LLM use enabled, it can ask the planner for repair actions and retry validation up to 3 times. If failures remain, the turn is reported as blocked instead of being marked successful.

Project and validation tools are also exposed through the registry/MCP path:

```text
project_profile
validation_plan
parse_errors
task_plan
task_add
task_update
task_reset
task_resume
```

## Code Intelligence, Init, Context, And Resume

The runtime now has a separate code intelligence path in addition to RAG:

- RAG is for natural-language workspace retrieval.
- Symbol index is for code structure: definitions, references, import/export analysis, outlines, and simple call graphs.

TypeScript and JavaScript are indexed with the TypeScript Compiler API. Python is indexed with a lightweight first-pass parser. The index skips `.git`, `node_modules`, `dist`, `build`, `coverage`, `target`, and `.code-agent`, then caches results under `.code-agent/symbols/index.json`.

Registered code intelligence tools:

```text
symbol_index
symbol_search
find_definition
find_references
analyze_imports
call_graph
code_outline
```

Project initialization:

```text
/init
```

`/init` analyzes the current workspace and writes:

- `.code-agent/project.md`: stack, directory structure, indexed files, and risk points.
- `.code-agent/rules.md`: project coding rules and protected directories.
- `.code-agent/commands.md`: inferred dev/test/build/typecheck/lint commands.

Context monitoring commands:

```text
/context   Show active context estimate, tool-result ratio, compression state, and CCR cache count.
/tokens    Show input/output and active token estimates.
/cost      Estimate cost for configured remote models; local Ollama-compatible models show 0/unavailable.
```

`/resume [selector]` switches the active session by list number, title/summary keyword, session id, id prefix, or `latest`. Running `/resume` without a selector lists readable session titles, summaries, timestamps, message counts, profiles, and short ids. Resume is a session switch: the target session replaces the active runtime messages and the `/resume` command itself is not appended to the target conversation. Cross-workspace sessions are rejected by default unless `--allow-workspace-switch` is provided. `/resume-task` continues the latest incomplete task plan.

## Git, Checkpoints, Revert, And Safety

The agent now keeps a lightweight change-safety loop around file writes:

- each normal prompt turn creates a checkpoint under `.code-agent/checkpoints/`;
- `write_file` and `edit_file` record the pre-write file contents and the post-write hash;
- `/changes` shows files touched by the latest checkpoint;
- `/revert` restores only files written by that checkpoint;
- if a file was changed again after the agent wrote it, `/revert` skips it instead of overwriting user work.

Git helper commands:

```text
/diff [path]       Show current git diff, or explain when the workspace is not a git repo.
/changes           Show files changed by the latest agent checkpoint.
/checkpoint        Create a manual rollback checkpoint.
/revert            Revert latest checkpoint changes without clobbering later user edits.
/commit-msg        Draft a commit message from current git status.
/risk <command>    Classify a shell command before running it.
```

Shell commands are risk-classified before execution:

- `safe`
- `write`
- `network`
- `destructive`
- `credential-risk`
- `system-risk`

Destructive and credential-risk commands are blocked by default, including `rm -rf`, `git reset --hard`, `git clean -fd`, `curl | sh`, `wget | bash`, and attempts to read `.env`, SSH keys, cookies, or credential stores.

Tool output, sessions, memory, RAG indexes, and CCR caches automatically redact common secrets such as API keys, tokens, passwords, cookies, and private keys. Redacted keys use forms like `sk-****abcd`.

Legacy verbose trace output looks like:

```text
╭────────────────────────╮
│ › read README.md       │
╰────────────────────────╯
• Running route "read README.md"
• Ran route tool:read_file
• Running read_file {"path":"README.md"}
• Ran read_file read 141 lines ... 2ms
• Running llm openai-compatible:qwen3:8b
• Ran llm ok
```

The trace is an auditable process log. Normal mode shows observable tool actions only; verbose mode includes routing, planner, reflection, memory, RAG, provider calls, saves, and durations. It does not expose hidden model chain-of-thought, planner prompts, or system prompts.

For OpenAI-compatible providers such as Ollama, assistant text streams token-by-token in the TTY UI. While the provider is generating, the composer shows a `Working ... elapsed` status line above the input box.

Provider thinking/reasoning output is folded into a separate `Thinking` trace line instead of being printed as assistant answer text. OpenAI-compatible fields such as `reasoning_content`, `reasoning`, and `thinking.content`, plus Qwen-style `<think>...</think>` blocks, are hidden by default. Use `CODE_AGENT_THINKING_DISPLAY=off|summary|verbose` or `/thinking off|summary|verbose` to control the status line. Even verbose mode reports source and character count only; it does not print hidden reasoning text.

## Terminal Markdown Rendering

In TTY normal mode, final assistant answers and user-visible completion summaries are rendered from Markdown into ANSI terminal output. Supported elements include headings, paragraphs, bold text, inline code, fenced code blocks, unordered and ordered lists, quote blocks, horizontal rules, links, and simple tables.

Rules:

- enabled by default in TTY normal mode;
- disabled for JSON output;
- disabled for non-TTY pipe output;
- disabled with `--no-markdown` or `/markdown off`;
- raw tool stdout/stderr, debug trace, and diffs are not Markdown-rendered.

Controls:

```powershell
codeagent --no-markdown
```

```text
/markdown on
/markdown off
```

Write/create/save prompts are treated as file-generation tasks. For example:

```text
请你给我编写一段N皇后解决问题的C语言代码保存在我本地文件夹下的TEST.py文件下
```

The runtime generates file content, then calls `write_file` directly. It does not try to read or list the missing target file first.

## Tool Calling

The runtime uses a model-driven tool loop:

1. local routing produces candidate commands and tools;
2. a coordinator prompt classifies the request;
3. a planner prompt returns JSON tool actions;
4. the runtime executes those tools, stores observations in the session, and asks the model to continue or finish.

This mirrors the `claw-code` flow where the model emits `ToolUse`, the runtime returns `ToolResult`, and the next model call sees the observation. With `--no-llm`, the runtime only runs deterministic read/list/search/url actions when inputs are obvious; it does not fabricate generated code.

## Agent Harness Architecture

The model is the agent; Code Agent is the harness around it. The harness provides tools, context, permissions, durable state, and observable execution, but it should not hardcode business workflows into the main loop.

The stable loop is intentionally small:

```text
model(messages, tools)
if no tool_use: return final text
execute tool_use through ToolPipeline
append tool_result observations
repeat
```

The first-stage harness split is:

- `src/core/agentLoop.ts`: model/tool-result loop with no tool-specific imports.
- `src/core/toolPipeline.ts`: normalize tool calls, run `PreToolUse`, execute handlers, run `PostToolUse`, and return observations.
- `src/core/hooks.ts`: permission, workspace boundary, command-risk, sensitive-path, checkpoint, redaction, and future audit hooks.
- `src/core/contextPipeline.ts`: memory/RAG/skill selection, CCR preparation, and system prompt assembly.
- `src/core/harness.ts`: wires the loop, registry, hooks, tool pipeline, and context pipeline together.
- `src/tools/registry.ts`: `ToolRegistry` owns schemas, permissions, risks, handlers, tags, long-running metadata, and MCP/model schema exports.

New capabilities should be added as tools, not by branching inside `runtime.ts`. MCP exposure uses the same registry and tool pipeline, so MCP `tools/call` still passes through permission and safety hooks. Skills are listed as a catalog by default; full skill workflows are loaded only through `skill_read` or `skill_use`.

## Web Search

Registered web tools:

```text
fetch_url   Fetch a specific HTTP/HTTPS URL.
web_search  Search the internet through a configured provider.
```

`web_search` currently supports Baidu AI Search:

```env
CODE_AGENT_WEB_SEARCH_PROVIDER=baidu-ai
BAIDU_AI_SEARCH_API_KEY=your_appbuilder_key
```

Without the key, the tool is visible to the model but returns a configuration error instead of pretending to search.

## MCP Server

Start the stdio MCP server:

```powershell
codeagent mcp-server
```

It exposes the registered tools through `tools/list` and `tools/call`, including file tools, web tools, and `ccr_retrieve`. The MCP server exports schemas from `ToolRegistry` and executes calls through the same permission, risk, redaction, and workspace-boundary pipeline as local runtime tools.

## Context Compression

Context compression modes:

```env
CODE_AGENT_CONTEXT_COMPRESSION=off
CODE_AGENT_CONTEXT_COMPRESSION=local
CODE_AGENT_CONTEXT_COMPRESSION=headroom
CODE_AGENT_HEADROOM_BASE_URL=http://localhost:8787
```

`local` is the default. Large tool results are summarized before model calls, while the original payload is saved under `.code-agent/ccr` and can be recovered with `ccr_retrieve`.

`headroom` mode assumes an external Headroom proxy is handling compression, so the agent skips local CCR compression. For a full Headroom proxy setup, run Headroom separately and point your OpenAI-compatible provider traffic at its proxy endpoint.

## Goals, Reflection, Memory, Recovery, RAG

The runtime now includes the project-agent control loops from the `aaagge` patterns:

- goal setting and monitoring: each turn creates goals and updates them from tool observations;
- selective reflection: simple read/list/search turns skip the reviewer, code changes and validation run light reflection, and failed or risky multi-step work runs full reflection;
- memory: durable project memory is stored under `.code-agent/memory/project.jsonl`;
- learning/adaptation: failures and reflection lessons are written back to memory;
- recovery: common tool failures trigger fallback actions, such as `read_file ENOENT -> list_dir + glob_search`;
- RAG: workspace files can be indexed into `.code-agent/rag/index.json` and searched through `rag_search`.
- skills: reusable task workflows live under `.code-agent/skills/` or `src/skills/builtin/`; they are separate from memory, RAG, goals, and tasks.

Useful commands:

```powershell
codeagent exec-tool rag_index "{}"
codeagent exec-tool rag_search "{ \"query\": \"planner recovery\" }"
codeagent exec-tool memory_search "{ \"query\": \"recovery\" }"
```

In the interactive shell:

```text
/goals
/memory recovery
/rag index .
/rag search planner recovery
```

## Verification

```powershell
npm run typecheck
npm test
python -m py_compile py/agent_bridge.py
```
