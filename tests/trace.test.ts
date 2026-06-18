import test from "node:test";
import assert from "node:assert/strict";
import { renderTurnSummary } from "../src/cli/render.js";
import { renderAssistantAnswer, renderInteractiveTurn, renderPromptBox, renderTokenUsageLine, renderTrace } from "../src/cli/trace.js";
import { stripAnsi } from "../src/cli/markdownRenderer.js";
import type { RuntimeConfig, TurnSummary } from "../src/core/types.js";

test("renders prompt box in plain text mode", () => {
  const output = renderPromptBox("帮我读取 README.md", false);
  assert.match(output, /╭/);
  assert.match(output, /› 帮我读取 README\.md/);
  assert.match(output, /╯/);
});

test("normal trace hides internal runtime events", () => {
  const output = renderTrace(
    [
      { type: "running", label: "route", detail: "\"read README.md\"" },
      { type: "ran", label: "coordinator", detail: "tool:read_file", ok: true },
      { type: "info", label: "memory", detail: "none" },
      { type: "running", label: "planner", detail: "mock" },
      { type: "ran", label: "reflection", detail: "pass", ok: true }
    ],
    false
  );
  assert.equal(output, "");
});

test("verbose trace shows detailed runtime events", () => {
  const output = renderTrace(
    [
      { type: "running", label: "route", detail: "\"read README.md\"" },
      { type: "ran", label: "planner", detail: "tool:read_file", ok: true }
    ],
    false,
    { verbose: true }
  );
  assert.match(output, /Running route/);
  assert.match(output, /Ran planner tool:read_file/);
});

test("normal trace hides reflection policy debug but shows skill load", () => {
  const output = renderTrace(
    [
      { type: "info", label: "reflection_policy", detail: "none: simple" },
      { type: "info", label: "skill", detail: "python-data-analysis (trigger:python)" }
    ],
    false
  );
  assert.doesNotMatch(output, /reflection_policy/);
  assert.match(output, /Skill\(python-data-analysis\)/);
});

test("normal trace renders thinking as collapsed summary", () => {
  const output = renderTrace(
    [{ type: "info", label: "thinking", detail: "reasoning_content: 42 chars hidden" }],
    false
  );
  assert.match(output, /Thinking/);
  assert.match(output, /reasoning received, hidden by default/);
  assert.doesNotMatch(output, /42 chars/);
});

test("thinking trace can be hidden or shown verbosely", () => {
  const hidden = renderTrace(
    [{ type: "info", label: "thinking", detail: "reasoning_content: 42 chars hidden" }],
    false,
    { thinkingDisplay: "off" }
  );
  const verbose = renderTrace(
    [{ type: "info", label: "thinking", detail: "reasoning_content: 42 chars hidden" }],
    false,
    { thinkingDisplay: "verbose" }
  );
  assert.equal(hidden, "");
  assert.match(verbose, /reasoning_content: 42 chars hidden/);
});

test("text turn summary respects normal and verbose trace modes", () => {
  const turn = fakeTurn({
    trace: [
      { type: "running", label: "route", detail: "\"read README.md\"" },
      { type: "ran", label: "route", detail: "tool:read_file", ok: true }
    ]
  });
  assert.doesNotMatch(renderTurnSummary(turn, "text"), /Running route/);
  assert.match(renderTurnSummary(turn, "text", { verbose: true }), /Running route/);
});

test("renders natural file read and shell summaries", () => {
  const output = renderTrace(
    [
      {
        type: "ran",
        label: "read_file",
        ok: true,
        durationMs: 3,
        input: { path: "README.md" },
        output: { kind: "text", path: "README.md", totalLines: 96, numLines: 96, content: "# Demo" }
      },
      {
        type: "ran",
        label: "shell",
        ok: true,
        durationMs: 2300,
        input: { command: "npm run typecheck" },
        output: { code: 0, stdout: "ok", stderr: "" }
      }
    ],
    false
  );
  assert.match(output, /● Read README\.md/);
  assert.match(output, /96 lines/);
  assert.match(output, /● Ran npm run typecheck/);
  assert.match(output, /Passed in 2\.3s/);
});

test("renders python execution summaries", () => {
  const output = renderTrace(
    [
      {
        type: "ran",
        label: "python_run_file",
        ok: true,
        durationMs: 400,
        input: { path: "demo.py" },
        output: {
          ok: false,
          exitCode: 1,
          durationMs: 400,
          scriptPath: "demo.py",
          stdout: "",
          stderr: "Traceback\nSyntaxError: invalid syntax",
          summary: "SyntaxError at line 1: invalid syntax"
        }
      }
    ],
    false
  );
  assert.match(output, /Ran python/);
  assert.match(output, /Failed in 400ms/);
  assert.match(output, /SyntaxError/);
});

test("renders file modification diff summary and truncates large diffs", () => {
  const largeDiff = Array.from({ length: 100 }, (_, index) => `+line-${index}`).join("\n");
  const output = renderTrace(
    [
      {
        type: "ran",
        label: "edit_file",
        ok: true,
        input: { path: "src/cli/terminalUi.ts" },
        output: { kind: "edit", path: "src/cli/terminalUi.ts", diff: largeDiff }
      }
    ],
    false
  );
  assert.match(output, /Edited src\/cli\/terminalUi\.ts \(\+100 -0\)/);
  assert.match(output, /\+line-0/);
  assert.match(output, /diff truncated/);
});

test("final summary includes modified files and validation commands", () => {
  const turn = fakeTurn({
    toolResults: [
      {
        role: "tool",
        blocks: [
          {
            type: "tool_result",
            toolUseId: "1",
            toolName: "edit_file",
            output: { path: "src/cli/repl.ts", diff: "+new\n-old" },
            isError: false
          }
        ]
      }
    ],
    trace: [
      {
        type: "ran",
        label: "shell",
        ok: true,
        durationMs: 100,
        input: { command: "npm test" },
        output: { code: 0, stdout: "pass", stderr: "" }
      }
    ]
  });
  const output = renderAssistantAnswer(turn, { includeSummary: true });
  assert.match(output, /修改摘要/);
  assert.match(output, /代码语义依据/);
  assert.match(output, /上下文使用情况/);
  assert.match(output, /src\/cli\/repl\.ts/);
  assert.match(output, /验证已通过/);
  assert.match(output, /npm test/);
});

test("normal assistant answer hides runtime fallback diagnostics", () => {
  const turn = fakeTurn({
    assistantMessages: [
      {
        role: "assistant",
        blocks: [
          {
            type: "text",
            text: "Prompt: read README.md\nRouted matches: tool:read_file\nTool observations: 1\nread_file: ok"
          }
        ]
      }
    ]
  });
  const output = renderAssistantAnswer(turn, { includeSummary: true });
  assert.doesNotMatch(output, /Routed matches/);
  assert.match(output, /本轮总结/);
});

test("simple fallback answer shows friendly unavailable notice instead of diagnostics", () => {
  const turn = fakeTurn({
    assistantMessages: [
      {
        role: "assistant",
        blocks: [
          {
            type: "text",
            text: "Prompt: 写介绍\nRouted matches: none\nTool observations: 0\n\nLLM unavailable: fetch failed"
          }
        ]
      }
    ]
  });
  const output = renderAssistantAnswer(turn, { includeSummary: false, dialogBlocks: false });
  assert.doesNotMatch(output, /Routed matches/);
  assert.match(output, /模型调用暂时不可用：fetch failed/);
});

test("renders final assistant markdown when enabled", () => {
  const turn = fakeTurn({
    assistantMessages: [
      {
        role: "assistant",
        blocks: [{ type: "text", text: "# Done\n\n- **Changed** `src/index.ts`" }]
      }
    ]
  });
  const output = renderAssistantAnswer(turn, { includeSummary: false, markdown: true, useColor: true, width: 80 });
  assert.match(output, /\x1b\[/);
  assert.match(stripAnsi(output), /Done/);
  assert.match(stripAnsi(output), /• Changed  src\/index\.ts /);
});

test("no-markdown rendering keeps raw markdown", () => {
  const turn = fakeTurn({
    assistantMessages: [
      {
        role: "assistant",
        blocks: [{ type: "text", text: "# Done\n\n- `raw`" }]
      }
    ]
  });
  assert.equal(renderAssistantAnswer(turn, { includeSummary: false, markdown: false, dialogBlocks: false }), "# Done\n\n- `raw`");
});

test("json turn summary does not contain ANSI control codes", () => {
  const output = renderTurnSummary(fakeTurn({
    assistantMessages: [
      {
        role: "assistant",
        blocks: [{ type: "text", text: "# Done" }]
      }
    ]
  }), "json", { markdown: true, useColor: true });
  assert.doesNotMatch(output, /\x1b\[/);
  assert.match(output, /# Done/);
});

test("renders full interactive turn with footer", () => {
  const config = fakeConfig();
  const turn = fakeTurn({
    trace: [{ type: "ran", label: "route", detail: "none", ok: true }]
  });
  const output = renderInteractiveTurn("hello", turn, config);
  assert.match(output, /\[You\]\nhello/);
  assert.match(output, /\[Agent\]\ndone/);
  assert.doesNotMatch(output, /Ran route none/);
  assert.match(output, /done/);
  assert.match(output, /qwen3:8b/);
});

test("renders per-turn token usage with estimated marker", () => {
  const output = renderTokenUsageLine(fakeTurn({
    turnUsage: { inputTokens: 1248, outputTokens: 392, estimated: true, source: "estimated" },
    contextReport: {
      sessionId: "test",
      messages: 1,
      promptHistory: 1,
      usage: { inputTokens: 1248, outputTokens: 392 },
      estimatedActiveTokens: 1440,
      toolResultTokens: 0,
      toolResultRatio: 0,
      compressionMode: "local",
      compactionDetected: false,
      ccrEntries: 0,
      cost: {
        provider: "openai-compatible",
        model: "qwen3:8b",
        local: true,
        estimatedUsd: 0,
        note: "local"
      }
    }
  }), fakeConfig(), false);
  assert.match(output, /Tokens: input ~1,248/);
  assert.match(output, /total ~1,640 estimated/);
  assert.match(output, /context 72%/);
});

test("token usage can be hidden", () => {
  const output = renderTokenUsageLine(fakeTurn({
    turnUsage: { inputTokens: 1, outputTokens: 2, source: "api" }
  }), { ...fakeConfig(), showTokenUsage: false }, false);
  assert.equal(output, "");
});

function fakeTurn(overrides: Partial<TurnSummary> = {}): TurnSummary {
  return {
    sessionId: "test",
    assistantMessages: [{ role: "assistant", blocks: [{ type: "text", text: "done" }] }],
    toolResults: [],
    routedMatches: [],
    iterations: 1,
    usage: { inputTokens: 1, outputTokens: 1 },
    stopReason: "completed",
    trace: [],
    ...overrides
  };
}

function fakeConfig(): RuntimeConfig {
  return {
    workspaceRoot: "E:\\demo",
    provider: "openai-compatible",
    model: "qwen3:8b",
    baseUrl: "http://localhost:11434/v1",
    apiKey: "ollama",
    permissionMode: "workspace-write",
    outputFormat: "text",
    maxTurns: 4,
    maxBudgetTokens: 2000,
    useLlm: false
  };
}
