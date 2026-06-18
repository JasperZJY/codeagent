import { TaskStore, summarizeTaskPlan } from "../core/tasks.js";
import type { TaskStatus } from "../core/types.js";

export async function taskPlanTool(_input: Record<string, unknown>, workspaceRoot: string): Promise<unknown> {
  const plan = await new TaskStore(workspaceRoot).loadCurrent();
  return {
    kind: "task_plan",
    plan,
    summary: summarizeTaskPlan(plan)
  };
}

export async function taskAddTool(input: Record<string, unknown>, workspaceRoot: string): Promise<unknown> {
  const content = requireString(input, "content");
  const plan = await new TaskStore(workspaceRoot).addTask(content);
  return {
    kind: "task_plan",
    plan,
    summary: summarizeTaskPlan(plan)
  };
}

export async function taskUpdateTool(input: Record<string, unknown>, workspaceRoot: string): Promise<unknown> {
  const id = requireString(input, "id");
  const status = normalizeTaskStatus(requireString(input, "status"));
  const evidence = typeof input["evidence"] === "string" ? input["evidence"] : "updated";
  const plan = await new TaskStore(workspaceRoot).updateTask(id, status, evidence);
  return {
    kind: "task_plan",
    plan,
    summary: summarizeTaskPlan(plan)
  };
}

export async function taskResetTool(_input: Record<string, unknown>, workspaceRoot: string): Promise<unknown> {
  await new TaskStore(workspaceRoot).reset();
  return { kind: "task_reset", ok: true };
}

export async function taskResumeTool(_input: Record<string, unknown>, workspaceRoot: string): Promise<unknown> {
  const plan = await new TaskStore(workspaceRoot).resumeLatestIncomplete();
  return {
    kind: "task_plan",
    plan,
    summary: summarizeTaskPlan(plan)
  };
}

function normalizeTaskStatus(value: string): TaskStatus {
  if (value === "pending" || value === "running" || value === "done" || value === "blocked" || value === "failed") {
    return value;
  }
  throw new Error(`invalid_task_status: ${value}`);
}

function requireString(input: Record<string, unknown>, key: string): string {
  const value = input[key];
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`invalid_tool_input: '${key}' must be a non-empty string`);
  }
  return value.trim();
}
