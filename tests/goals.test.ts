import test from "node:test";
import assert from "node:assert/strict";
import { startTurnGoals, updateGoalsFromExecution } from "../src/core/goals.js";
import type { PersistedSession } from "../src/core/session.js";

test("creates and updates goals from tool observations", () => {
  const session = fakeSession();
  const goals = startTurnGoals(session, "请读取 README.md 并保存结果到 out.md");
  assert.equal(goals.some((goal) => goal.title.includes("Inspect")), true);
  assert.equal(goals.some((goal) => goal.title.includes("Create")), true);

  updateGoalsFromExecution(goals, {
    toolName: "read_file",
    input: { path: "README.md" },
    ok: true,
    output: { kind: "text", path: "README.md", numLines: 3 },
    durationMs: 1
  });
  assert.equal(goals.some((goal) => goal.status === "done"), true);
});

function fakeSession(): PersistedSession {
  return {
    version: 1,
    sessionId: "s",
    createdAt: "2026-06-16T00:00:00.000Z",
    updatedAt: "2026-06-16T00:00:00.000Z",
    workspaceRoot: "E:\\demo",
    model: "qwen3:8b",
    messages: [],
    promptHistory: [],
    usage: { inputTokens: 0, outputTokens: 0 },
    goals: []
  };
}
