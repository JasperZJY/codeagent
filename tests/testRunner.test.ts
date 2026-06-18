import test from "node:test";
import assert from "node:assert/strict";
import { runTestFixLoop } from "../src/core/testRunner.js";
import type { ToolExecution } from "../src/core/types.js";

test("test-fix loop retries at most three fix attempts", async () => {
  let fixAttempts = 0;
  let runs = 0;
  const result = await runTestFixLoop({
    commands: ["npm test"],
    maxFixAttempts: 3,
    runCommand: async () => {
      runs += 1;
      return shellResult(1, "AssertionError: Expected route list_dir, got answer\n    at tests/router.test.js:31:10");
    },
    fixAttempt: async () => {
      fixAttempts += 1;
      return true;
    }
  });
  assert.equal(result.status, "failed");
  assert.equal(result.fixAttempts, 3);
  assert.equal(fixAttempts, 3);
  assert.equal(runs, 4);
});

test("test-fix loop returns warning when no validation command exists", async () => {
  const result = await runTestFixLoop({
    commands: [],
    runCommand: async () => shellResult(0, "")
  });
  assert.equal(result.status, "warning");
  assert.match(result.message, /No validation commands/);
});

test("test-fix loop reports blocked when failures cannot be repaired", async () => {
  const result = await runTestFixLoop({
    commands: ["npm run typecheck"],
    runCommand: async () => shellResult(2, "src/index.ts(1,1): error TS1005: ';' expected.")
  });
  assert.equal(result.status, "blocked");
  assert.equal(result.needsUserIntervention, true);
  assert.equal(result.errors[0]?.type, "TS1005");
});

function shellResult(code: number, stderr: string): ToolExecution {
  return {
    toolName: "shell",
    input: {},
    ok: true,
    output: { code, stdout: "", stderr },
    durationMs: 1
  };
}
