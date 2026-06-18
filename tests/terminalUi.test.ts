import test from "node:test";
import assert from "node:assert/strict";
import { Writable } from "node:stream";
import { renderMarkdownForTerminal } from "../src/cli/markdownRenderer.js";
import { renderAgentStreamHeader } from "../src/cli/terminalBlocks.js";
import { TerminalUi, renderCommandPalette, renderInputBox } from "../src/cli/terminalUi.js";
import type { PersistedSession } from "../src/core/session.js";
import type { RuntimeConfig } from "../src/core/types.js";

test("renders fixed composer-style input box", () => {
  const output = renderInputBox("帮我读取 README.md", 60);
  assert.match(output, /╭/);
  assert.match(output, /│ › 帮我读取 README\.md/);
  assert.match(output, /╰/);
});

test("keeps the tail of long input visible", () => {
  const output = renderInputBox("请帮我读取一个非常非常长的路径 src/core/runtime.ts", 32);
  assert.match(output, /\.\.\./);
  assert.match(output, /runtime\.ts/);
});

test("renders streamed text above the composer", () => {
  const output = new CaptureOutput();
  const ui = new TerminalUi(fakeConfig(), fakeSession(), output);
  ui.appendLine("• Running llm openai-compatible:qwen3:8b");
  ui.appendLine("");
  ui.appendText("hello");
  ui.appendText(" world");
  ui.setInput("next prompt");
  ui.render();

  assert.match(output.value, /hello world/);
  assert.match(output.value, /› next prompt/);
});

test("keeps first streamed agent token off the dialog header line", () => {
  const output = new CaptureOutput();
  const ui = new TerminalUi(fakeConfig(), fakeSession(), output);
  ui.appendLine(renderAgentStreamHeader({ enabled: true, useColor: false, width: 48 }));
  ui.appendLine("");
  ui.appendText("hello");
  ui.renderNow();

  const agentIndex = output.value.indexOf("Agent");
  const helloIndex = output.value.indexOf("hello");
  assert.ok(agentIndex >= 0);
  assert.ok(helloIndex > agentIndex);
  assert.match(output.value.slice(agentIndex, helloIndex), /\n/);
});

test("renders working status above the composer", () => {
  const output = new CaptureOutput();
  const ui = new TerminalUi(fakeConfig(), fakeSession(), output);
  ui.appendLine("• Running llm openai-compatible:qwen3:8b");
  ui.setWorkingStatus("Working llm... 3s elapsed");
  ui.setInput("draft");
  ui.render();

  assert.match(output.value, /Working llm\.\.\. 3s elapsed/);
  assert.match(output.value, /› draft/);
});

test("does not resend terminal setup sequences on every render", () => {
  const output = new CaptureOutput();
  const ui = new TerminalUi(fakeConfig(), fakeSession(), output);
  ui.renderNow();
  ui.renderNow();
  ui.close();

  assert.equal(count(output.value, "\x1b[?25l"), 1);
  assert.equal(count(output.value, "\x1b[3J"), 0);
});

test("scrollback terminal mode does not enter alternate screen", () => {
  const output = new CaptureOutput();
  const ui = new TerminalUi({ ...fakeConfig(), terminalMode: "scrollback" }, fakeSession(), output);
  ui.renderNow();
  ui.close();

  assert.equal(count(output.value, "\x1b[?1049h"), 0);
  assert.equal(count(output.value, "\x1b[?1049l"), 0);
});

test("scrolls the history viewport above the composer", () => {
  const output = new CaptureOutput();
  output.rows = 10;
  const ui = new TerminalUi(fakeConfig(), fakeSession(), output);
  for (let index = 1; index <= 20; index += 1) {
    ui.appendLine(`line-${String(index).padStart(2, "0")}`);
  }

  output.reset();
  ui.renderNow();
  assert.doesNotMatch(output.value, /line-01/);
  assert.match(output.value, /line-20/);

  output.reset();
  ui.scrollPage("up");
  ui.renderNow();
  assert.match(output.value, /line-10/);
  assert.doesNotMatch(output.value, /line-20/);

  output.reset();
  ui.scrollToTop();
  ui.renderNow();
  assert.match(output.value, /line-01/);

  output.reset();
  ui.scrollToBottom();
  ui.renderNow();
  assert.match(output.value, /line-20/);
});

test("renders slash command suggestions above the composer", () => {
  const output = new CaptureOutput();
  const ui = new TerminalUi(fakeConfig(), fakeSession(), output);
  ui.setSuggestions([{ usage: "/status", description: "Show current runtime status." }]);
  ui.setInput("/st");
  ui.render();

  assert.match(output.value, /> \/status/);
  assert.match(output.value, /› \/st/);
  assert.match(renderCommandPalette([], 80), /^$/);
});

test("renders slash menu block above the fixed composer", () => {
  const output = new CaptureOutput();
  const ui = new TerminalUi(fakeConfig(), fakeSession(), output);
  ui.setMenuBlock("+- Commands ----+\n| > python      |\n+---------------+");
  ui.setInput("/");
  ui.renderNow();

  assert.match(output.value, /Commands/);
  assert.match(output.value, /> python/);
  assert.match(output.value, /鈥?\//);
});

test("plain history strips ANSI and terminal block decorations for copy", () => {
  const output = new CaptureOutput();
  const ui = new TerminalUi(fakeConfig(), fakeSession(), output);
  ui.appendBlock("[You]\n你好");
  ui.appendBlock("\x1b[32m[Agent]\x1b[0m\n完成");

  assert.match(ui.plainHistory(), /你好/);
  assert.match(ui.plainHistory(), /完成/);
  assert.doesNotMatch(ui.plainHistory(), /\x1b\[/);
});

test("keeps fixed composer intact with ANSI markdown history", () => {
  const output = new CaptureOutput();
  output.columns = 48;
  const ui = new TerminalUi(fakeConfig(), fakeSession(), output);
  ui.appendBlock(renderMarkdownForTerminal("# Result\n\n- `code` item", { useColor: true, width: 48 }));
  ui.setInput("next");
  ui.renderNow();

  assert.match(output.value, /\x1b\[/);
  assert.match(output.value, /Result/);
  assert.match(output.value, /› next/);
});

class CaptureOutput extends Writable {
  columns = 80;
  rows = 20;
  value = "";

  override _write(chunk: Buffer | string, _encoding: BufferEncoding, callback: (error?: Error | null) => void): void {
    this.value += chunk.toString();
    callback();
  }

  reset(): void {
    this.value = "";
  }
}

function count(value: string, needle: string): number {
  return value.split(needle).length - 1;
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
    useLlm: true
  };
}

function fakeSession(): PersistedSession {
  return {
    version: 1,
    sessionId: "test",
    createdAt: "2026-06-16T00:00:00.000Z",
    updatedAt: "2026-06-16T00:00:00.000Z",
    workspaceRoot: "E:\\demo",
    model: "qwen3:8b",
    messages: [],
    promptHistory: [],
    usage: { inputTokens: 0, outputTokens: 0 }
  };
}
