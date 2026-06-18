import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { AgentRuntime } from "../src/core/runtime.js";
import { TaskStore, updatePlanFromExecution } from "../src/core/tasks.js";
import type { RuntimeConfig, ToolExecution } from "../src/core/types.js";

test("complex runtime task automatically creates a persisted plan", async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), "code-agent-plan-runtime-"));
  await writeFile(path.join(workspace, "README.md"), "# Demo\n", "utf8");
  const runtime = new AgentRuntime(config(workspace));

  const turn = await runtime.runTurn("请先阅读 README.md，然后分析这个项目结构并给出后续实现计划", 5);
  assert.equal(turn.stopReason, "completed");
  assert.ok(turn.taskPlan);
  assert.match(turn.taskPlan?.tasks.map((task) => task.title).join("\n") ?? "", /Inspect relevant project context/);
  assert.equal(await readFile(path.join(workspace, ".code-agent", "tasks", "current.json"), "utf8").then(Boolean), true);
});

test("plan status advances from pending/running to done after execution evidence", async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), "code-agent-plan-state-"));
  const store = new TaskStore(workspace);
  const plan = await store.createPlan("请阅读项目并实现功能，然后运行测试");
  assert.equal(plan.tasks[0]?.status, "running");
  assert.equal(plan.tasks[1]?.status, "pending");

  updatePlanFromExecution(plan, execution("read_file", { path: "README.md" }));
  assert.equal(plan.tasks[0]?.status, "done");
  assert.equal(plan.tasks.some((task) => task.status === "running"), true);

  updatePlanFromExecution(plan, execution("edit_file", { path: "src/index.ts" }));
  assert.equal(plan.tasks.some((task) => task.status === "done" && /Implement/.test(task.title)), true);
});

test("resume task restores the latest incomplete plan", async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), "code-agent-plan-resume-"));
  const store = new TaskStore(workspace);
  const created = await store.createPlan("请阅读项目并实现功能，然后运行测试");
  const resumed = await store.resumeLatestIncomplete();
  assert.equal(resumed?.id, created.id);
  assert.equal(resumed?.status, "running");
});

test("simple chat does not implicitly resume an incomplete plan", async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), "code-agent-plan-simple-chat-"));
  const store = new TaskStore(workspace);
  await store.createPlan("implement feature and run tests");
  const runtime = new AgentRuntime(config(workspace));

  const turn = await runtime.runTurn("你是什么大模型", 5);

  assert.equal(turn.taskPlan, undefined);
  assert.equal(turn.summary?.style, "none");
});

function config(workspaceRoot: string): RuntimeConfig {
  return {
    workspaceRoot,
    provider: "openai-compatible",
    model: "qwen3:8b",
    baseUrl: "http://localhost:11434/v1",
    apiKey: "ollama",
    permissionMode: "workspace-write",
    outputFormat: "json",
    maxTurns: 4,
    maxBudgetTokens: 2000,
    useLlm: false
  };
}

function execution(toolName: string, output: unknown): ToolExecution {
  return {
    toolName,
    input: {},
    ok: true,
    output,
    durationMs: 1
  };
}
