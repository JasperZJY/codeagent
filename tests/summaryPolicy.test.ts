import test from "node:test";
import assert from "node:assert/strict";
import { decideSummary } from "../src/core/summaryPolicy.js";
import type { ConversationMessage, TurnSummary } from "../src/core/types.js";

test("simple answer does not show summary in auto mode", () => {
  const decision = decideSummary(fakeTurn(), "auto");
  assert.equal(decision.shouldShowSummary, false);
  assert.equal(decision.style, "none");
});

test("read_file-only turn does not show template summary", () => {
  const decision = decideSummary(fakeTurn([tool("read_file", { path: "README.md" })]), "auto");
  assert.equal(decision.shouldShowSummary, false);
});

test("file modification shows brief summary", () => {
  const decision = decideSummary(fakeTurn([tool("edit_file", { path: "src/index.ts", diff: "+x" })]), "auto");
  assert.equal(decision.shouldShowSummary, true);
  assert.equal(decision.style, "brief");
});

test("failure shows brief summary", () => {
  const decision = decideSummary(fakeTurn([tool("read_file", "ENOENT", true)]), "auto");
  assert.equal(decision.shouldShowSummary, true);
  assert.equal(decision.style, "brief");
});

test("summary mode off and always override auto", () => {
  assert.equal(decideSummary(fakeTurn([tool("edit_file", { path: "a.ts" })]), "off").shouldShowSummary, false);
  assert.equal(decideSummary(fakeTurn(), "always").style, "full");
});

function fakeTurn(toolResults: ConversationMessage[] = []): TurnSummary {
  return {
    sessionId: "test",
    assistantMessages: [{ role: "assistant", blocks: [{ type: "text", text: "done" }] }],
    toolResults,
    routedMatches: [],
    iterations: 1,
    usage: { inputTokens: 1, outputTokens: 1 },
    stopReason: "completed",
    trace: []
  };
}

function tool(toolName: string, output: unknown, isError = false): ConversationMessage {
  return {
    role: "tool",
    blocks: [{ type: "tool_result", toolUseId: "1", toolName, output, isError }]
  };
}
