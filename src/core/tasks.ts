import { constants } from "node:fs";
import { access, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { AgentTask, AgentTaskPlan, TaskStatus, TestFixLoopResult, ToolExecution } from "./types.js";

export class TaskStore {
  private readonly taskDir: string;
  private readonly currentPath: string;

  constructor(private readonly workspaceRoot: string) {
    this.taskDir = path.join(workspaceRoot, ".code-agent", "tasks");
    this.currentPath = path.join(this.taskDir, "current.json");
  }

  async ensurePlanForPrompt(prompt: string, sessionId?: string): Promise<AgentTaskPlan | undefined> {
    const current = await this.loadCurrent();
    if (current && !isTerminalStatus(current.status)) {
      if (shouldResumeCurrentPlan(prompt)) {
        return this.markNextPendingRunning(current, "resumed incomplete plan");
      }
      return undefined;
    }
    if (!isComplexTask(prompt)) {
      return undefined;
    }
    const plan = createTaskPlan(prompt, sessionId);
    return await this.save(plan);
  }

  async createPlan(prompt: string, sessionId?: string): Promise<AgentTaskPlan> {
    return await this.save(createTaskPlan(prompt, sessionId));
  }

  async loadCurrent(): Promise<AgentTaskPlan | undefined> {
    if (!(await exists(this.currentPath))) {
      return undefined;
    }
    return normalizePlan(JSON.parse(await readFile(this.currentPath, "utf8")));
  }

  async resumeLatestIncomplete(): Promise<AgentTaskPlan | undefined> {
    const current = await this.loadCurrent();
    if (current && !isTerminalStatus(current.status)) {
      return this.markNextPendingRunning(current, "resumed current plan");
    }
    if (!(await exists(this.taskDir))) {
      return undefined;
    }
    const files = (await readdir(this.taskDir))
      .filter((file) => file.startsWith("plan-") && file.endsWith(".json"))
      .sort()
      .reverse();
    for (const file of files) {
      const plan = normalizePlan(JSON.parse(await readFile(path.join(this.taskDir, file), "utf8")));
      if (!plan) {
        continue;
      }
      if (!isTerminalStatus(plan.status)) {
        return this.markNextPendingRunning(plan, "resumed latest incomplete plan");
      }
    }
    return undefined;
  }

  async addTask(content: string): Promise<AgentTaskPlan> {
    const plan = await this.loadCurrent() ?? createTaskPlan("Manual task plan");
    const now = new Date().toISOString();
    plan.tasks.push({
      id: nextTaskId(plan.tasks),
      title: content.trim(),
      status: "pending",
      reason: "added from /task add",
      evidence: "",
      updatedAt: now
    });
    plan.status = "running";
    plan.updatedAt = now;
    return await this.save(plan);
  }

  async updateTask(id: string, status: TaskStatus, evidence: string): Promise<AgentTaskPlan> {
    const plan = await this.requireCurrent();
    const task = plan.tasks.find((item) => item.id.toLowerCase() === id.toLowerCase());
    if (!task) {
      throw new Error(`task_not_found: ${id}`);
    }
    updateTask(task, status, "updated by slash command", evidence);
    refreshPlanStatus(plan);
    return await this.save(plan);
  }

  async reset(): Promise<void> {
    await mkdir(this.taskDir, { recursive: true });
    await rm(this.currentPath, { force: true });
  }

  async save(plan: AgentTaskPlan): Promise<AgentTaskPlan> {
    await mkdir(this.taskDir, { recursive: true });
    plan.updatedAt = new Date().toISOString();
    await writeFile(this.currentPath, `${JSON.stringify(plan, null, 2)}\n`, "utf8");
    await writeFile(path.join(this.taskDir, `plan-${plan.id}.json`), `${JSON.stringify(plan, null, 2)}\n`, "utf8");
    return plan;
  }

  async markNextPendingRunning(plan: AgentTaskPlan, reason: string): Promise<AgentTaskPlan> {
    const running = plan.tasks.find((task) => task.status === "running");
    if (!running) {
      const next = plan.tasks.find((task) => task.status === "pending");
      if (next) {
        updateTask(next, "running", reason, "started");
      }
    }
    plan.status = "running";
    return await this.save(plan);
  }

  private async requireCurrent(): Promise<AgentTaskPlan> {
    const plan = await this.loadCurrent();
    if (!plan) {
      throw new Error("task_plan_not_found");
    }
    return plan;
  }
}

export function isComplexTask(prompt: string): boolean {
  const normalized = prompt.trim();
  if (normalized.length >= 120) {
    return true;
  }
  if (/\n\s*(?:[-*]|\d+[.)])\s+/.test(normalized)) {
    return true;
  }
  const lowered = normalized.toLowerCase();
  const hits = [
    "实现",
    "分析",
    "增加",
    "新增",
    "完善",
    "优化",
    "架构",
    "结构",
    "测试",
    "自动",
    "阶段",
    "闭环",
    "runtime",
    "planner",
    "todo",
    "plan",
    "test-fix",
    "slash",
    "implement",
    "refactor",
    "feature"
  ].filter((needle) => lowered.includes(needle)).length;
  return hits >= 2;
}

export function shouldResumeCurrentPlan(prompt: string): boolean {
  if (isComplexTask(prompt)) {
    return true;
  }
  const lowered = prompt.trim().toLowerCase();
  return [
    "继续",
    "接着",
    "上次",
    "任务",
    "计划",
    "resume",
    "continue",
    "task",
    "todo",
    "plan"
  ].some((needle) => lowered.includes(needle));
}

export function createTaskPlan(prompt: string, sessionId?: string): AgentTaskPlan {
  const now = new Date().toISOString();
  const tasks = inferTaskTitles(prompt).map<AgentTask>((title, index) => ({
    id: `T${index + 1}`,
    title,
    status: index === 0 ? "running" : "pending",
    reason: index === 0 ? "initial planning started" : "waiting for earlier tasks",
    evidence: "",
    updatedAt: now
  }));
  const plan: AgentTaskPlan = {
    id: randomUUID(),
    prompt,
    status: "running",
    tasks,
    createdAt: now,
    updatedAt: now
  };
  if (sessionId) {
    plan.sessionId = sessionId;
  }
  return plan;
}

export function updatePlanFromExecution(plan: AgentTaskPlan, execution: ToolExecution): void {
  const output = execution.output && typeof execution.output === "object"
    ? execution.output as Record<string, unknown>
    : {};
  const shellCode = typeof output["code"] === "number" ? output["code"] : undefined;
  const ok = execution.ok && (execution.toolName !== "shell" || shellCode === 0);
  if (!ok) {
    const task = currentTask(plan);
    if (task) {
      updateTask(task, "blocked", `${execution.toolName} failed`, summarizeToolFailure(execution));
    }
    refreshPlanStatus(plan);
    return;
  }

  const current = currentTask(plan);
  if (current && /clarify|outcome|constraints/i.test(current.title)) {
    updateTask(current, "done", "request accepted", "requirements captured");
  }
  const task = taskForTool(plan, execution.toolName);
  if (task && task.status !== "done") {
    updateTask(task, "done", `${execution.toolName} completed`, summarizeToolSuccess(execution));
  }
  const next = plan.tasks.find((item) => item.status === "pending");
  if (next) {
    updateTask(next, "running", "previous task completed", "ready");
  }
  refreshPlanStatus(plan);
}

export function updatePlanFromValidation(plan: AgentTaskPlan, validation: TestFixLoopResult): void {
  const validationTask = findTask(plan, ["validation", "验证", "测试"]) ?? currentTask(plan);
  if (!validationTask) {
    return;
  }
  if (validation.status === "passed") {
    updateTask(validationTask, "done", "validation passed", validation.message);
  } else if (validation.status === "warning") {
    updateTask(validationTask, "blocked", "validation unavailable", validation.message);
  } else {
    updateTask(validationTask, validation.status === "failed" ? "failed" : "blocked", "validation failed", validation.message);
  }
  refreshPlanStatus(plan);
}

export function finalizePlan(plan: AgentTaskPlan, success: boolean, evidence: string): void {
  const reportTask = findTask(plan, ["report", "总结", "报告"]);
  if (reportTask && reportTask.status !== "done") {
    updateTask(reportTask, success ? "done" : "blocked", "final report generated", evidence);
  }
  refreshPlanStatus(plan);
}

export function summarizeTaskPlan(plan: AgentTaskPlan | undefined): string {
  if (!plan) {
    return "No active plan.";
  }
  return [
    `Plan ${plan.id} [${plan.status}]`,
    ...plan.tasks.map((task) => {
      const evidence = task.evidence ? ` - ${task.evidence}` : "";
      return `- [${task.status}] ${task.id} ${task.title}${evidence}`;
    })
  ].join("\n");
}

function inferTaskTitles(prompt: string): string[] {
  const lowered = prompt.toLowerCase();
  const titles = ["Clarify requested outcome and constraints"];
  if (includesAny(lowered, ["阅读", "查看", "read", "inspect", "项目", "文件", "结构", "runtime", "planner"])) {
    titles.push("Inspect relevant project context");
  }
  if (includesAny(lowered, ["实现", "增加", "新增", "修改", "完善", "优化", "implement", "add", "modify", "refactor"])) {
    titles.push("Implement requested changes");
  }
  if (includesAny(lowered, ["测试", "验证", "test", "typecheck", "lint", "build", "修复"])) {
    titles.push("Run validation and repair failures");
  } else {
    titles.push("Run available project validation");
  }
  titles.push("Report outcome, risks, and next steps");
  return [...new Set(titles)].slice(0, 8);
}

function taskForTool(plan: AgentTaskPlan, toolName: string): AgentTask | undefined {
  if (toolName === "read_file" || toolName === "list_dir" || toolName === "grep_search" || toolName === "glob_search") {
    return findTask(plan, ["inspect", "context", "阅读", "查看"]) ?? currentTask(plan);
  }
  if (toolName === "write_file" || toolName === "edit_file") {
    return findTask(plan, ["implement", "changes", "实现", "修改"]) ?? currentTask(plan);
  }
  if (toolName === "shell") {
    return findTask(plan, ["validation", "验证", "测试"]) ?? currentTask(plan);
  }
  return currentTask(plan);
}

function currentTask(plan: AgentTaskPlan): AgentTask | undefined {
  return plan.tasks.find((task) => task.status === "running")
    ?? plan.tasks.find((task) => task.status === "pending");
}

function findTask(plan: AgentTaskPlan, needles: string[]): AgentTask | undefined {
  const lowered = needles.map((needle) => needle.toLowerCase());
  return plan.tasks.find((task) => {
    const title = task.title.toLowerCase();
    return lowered.some((needle) => title.includes(needle));
  });
}

function updateTask(task: AgentTask, status: TaskStatus, reason: string, evidence: string): void {
  task.status = status;
  task.reason = reason;
  task.evidence = evidence;
  task.updatedAt = new Date().toISOString();
}

function refreshPlanStatus(plan: AgentTaskPlan): void {
  if (plan.tasks.some((task) => task.status === "failed")) {
    plan.status = "failed";
  } else if (plan.tasks.some((task) => task.status === "blocked")) {
    plan.status = "blocked";
  } else if (plan.tasks.every((task) => task.status === "done")) {
    plan.status = "done";
  } else {
    plan.status = "running";
  }
  plan.updatedAt = new Date().toISOString();
}

function normalizePlan(value: unknown): AgentTaskPlan | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  const plan = value as AgentTaskPlan;
  if (!plan.id || !Array.isArray(plan.tasks)) {
    return undefined;
  }
  return plan;
}

function nextTaskId(tasks: AgentTask[]): string {
  const max = tasks
    .map((task) => Number(task.id.replace(/^T/i, "")))
    .filter((value) => Number.isInteger(value))
    .reduce((highest, value) => Math.max(highest, value), 0);
  return `T${max + 1}`;
}

function isTerminalStatus(status: TaskStatus): boolean {
  return status === "done" || status === "failed";
}

function summarizeToolSuccess(execution: ToolExecution): string {
  if (execution.output && typeof execution.output === "object") {
    const output = execution.output as Record<string, unknown>;
    if (typeof output["path"] === "string") {
      return `${execution.toolName} ${output["path"]}`;
    }
    if (typeof output["numMatches"] === "number") {
      return `${execution.toolName} matched ${output["numMatches"]}`;
    }
    if (Array.isArray(output["entries"])) {
      return `${execution.toolName} listed ${output["entries"].length}`;
    }
  }
  return `${execution.toolName} ok`;
}

function summarizeToolFailure(execution: ToolExecution): string {
  return String(execution.output).replace(/\s+/g, " ").trim().slice(0, 240);
}

function includesAny(value: string, needles: string[]): boolean {
  return needles.some((needle) => value.includes(needle));
}

async function exists(filePath: string): Promise<boolean> {
  try {
    await access(filePath, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}
