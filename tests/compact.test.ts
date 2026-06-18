import test from "node:test";
import assert from "node:assert/strict";
import { compactTerminalOutput } from "../src/cli/compact.js";

test("keeps short output unchanged", () => {
  const output = compactTerminalOutput("one\ntwo", { maxLines: 10 });
  assert.equal(output.truncated, false);
  assert.equal(output.text, "one\ntwo");
});

test("compacts long output with omitted line count", () => {
  const text = Array.from({ length: 40 }, (_, index) => `line-${index}`).join("\n");
  const output = compactTerminalOutput(text, { maxLines: 8, headLines: 3, tailLines: 3 });
  assert.equal(output.truncated, true);
  assert.match(output.text, /line-0/);
  assert.match(output.text, /line-39/);
  assert.match(output.text, /lines omitted/);
});

test("preserves error lines when compacting", () => {
  const lines = Array.from({ length: 50 }, (_, index) => `line-${index}`);
  lines[25] = "tests/router.test.ts:31 assertion failed expected list_dir";
  const output = compactTerminalOutput(lines.join("\n"), { maxLines: 10, headLines: 2, tailLines: 2 });
  assert.match(output.text, /assertion failed/);
  assert.match(output.text, /tests\/router\.test\.ts:31/);
});

test("preserves diff hunks when compacting", () => {
  const lines = Array.from({ length: 40 }, (_, index) => `context-${index}`);
  lines[20] = "@@ -1,2 +1,3 @@";
  lines[21] = "+added";
  const output = compactTerminalOutput(lines.join("\n"), { maxLines: 10, headLines: 2, tailLines: 2 });
  assert.match(output.text, /@@ -1,2 \+1,3 @@/);
  assert.match(output.text, /\+added/);
});
