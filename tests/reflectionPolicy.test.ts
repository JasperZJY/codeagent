import test from "node:test";
import assert from "node:assert/strict";
import { decideReflection } from "../src/core/reflectionPolicy.js";
import type { ConversationMessage } from "../src/core/types.js";

test("simple question does not trigger reflection", () => {
  const decision = decideReflection({ prompt: "what is this file", toolResults: [], trace: [] });
  assert.equal(decision.shouldReflect, false);
  assert.equal(decision.level, "none");
});

test("read_file-only turn does not trigger reflection", () => {
  const decision = decideReflection({
    prompt: "read README.md",
    toolResults: [tool("read_file", { path: "README.md" })],
    trace: []
  });
  assert.equal(decision.shouldReflect, false);
});

test("file modification triggers light reflection", () => {
  const decision = decideReflection({
    prompt: "edit file",
    toolResults: [tool("edit_file", { path: "src/index.ts" })],
    trace: []
  });
  assert.equal(decision.shouldReflect, true);
  assert.equal(decision.level, "light");
});

test("test failure and repeated tool failures trigger full reflection", () => {
  const failedValidation = decideReflection({
    prompt: "fix tests",
    toolResults: [],
    trace: [],
    validation: {
      status: "failed",
      attempts: 1,
      fixAttempts: 0,
      commands: [],
      errors: [],
      message: "failed",
      needsUserIntervention: true
    }
  });
  assert.equal(failedValidation.level, "full");

  const repeatedFailures = decideReflection({
    prompt: "inspect",
    toolResults: [tool("read_file", "nope", true), tool("grep_search", "bad", true)],
    trace: []
  });
  assert.equal(repeatedFailures.level, "full");
});

test("explicit reflection request triggers full reflection", () => {
  const decision = decideReflection({ prompt: "请反思一下你的方案", toolResults: [], trace: [] });
  assert.equal(decision.shouldReflect, true);
  assert.equal(decision.level, "full");
});

function tool(toolName: string, output: unknown, isError = false): ConversationMessage {
  return {
    role: "tool",
    blocks: [{ type: "tool_result", toolUseId: "1", toolName, output, isError }]
  };
}
