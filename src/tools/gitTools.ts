import { spawn } from "node:child_process";
import path from "node:path";
import { ChangeTracker } from "../core/changeTracker.js";
import { analyzeCommandRisk } from "../core/security.js";

export async function gitStatusTool(_input: Record<string, unknown>, workspaceRoot: string): Promise<unknown> {
  const result = await runGit(["status", "--short"], workspaceRoot);
  if (!result.isGitRepo) {
    return result;
  }
  return {
    kind: "git_status",
    isGitRepo: true,
    files: parseStatus(result.stdout),
    raw: result.stdout
  };
}

export async function gitDiffTool(input: Record<string, unknown>, workspaceRoot: string): Promise<unknown> {
  const target = typeof input["path"] === "string" ? input["path"] : ".";
  const result = await runGit(["diff", "--no-ext-diff", "--", target], workspaceRoot);
  if (!result.isGitRepo) {
    return result;
  }
  const diff = result.stdout;
  return {
    kind: "git_diff",
    isGitRepo: true,
    path: target,
    diff,
    summary: summarizeDiff(diff)
  };
}

export async function gitCommitMessageTool(_input: Record<string, unknown>, workspaceRoot: string): Promise<unknown> {
  const status = await gitStatusTool({}, workspaceRoot) as { isGitRepo?: boolean; files?: Array<{ path: string; status: string }>; message?: string };
  if (!status.isGitRepo) {
    return status;
  }
  const files = status.files ?? [];
  const changed = files.map((file) => file.path);
  const scope = changed.length === 0
    ? "workspace"
    : changed.length === 1
      ? path.basename(changed[0] ?? "workspace")
      : `${changed.length} files`;
  const action = changed.length === 0 ? "record workspace state" : `update ${scope}`;
  return {
    kind: "commit_message",
    files,
    message: [
      `chore: ${action}`,
      "",
      ...changed.slice(0, 8).map((file) => `- ${file}`),
      ...(changed.length > 8 ? [`- ... ${changed.length - 8} more files`] : [])
    ].join("\n")
  };
}

export async function checkpointCreateTool(input: Record<string, unknown>, workspaceRoot: string): Promise<unknown> {
  const tracker = new ChangeTracker(workspaceRoot);
  const reason = typeof input["reason"] === "string" && input["reason"].trim() ? input["reason"].trim() : "manual";
  const checkpoint = await tracker.createCheckpoint({ reason });
  return {
    kind: "checkpoint",
    checkpointId: checkpoint.id,
    reason: checkpoint.reason,
    files: checkpoint.files.length,
    path: `.code-agent/checkpoints/${checkpoint.id}.json`
  };
}

export async function changesSummaryTool(_input: Record<string, unknown>, workspaceRoot: string): Promise<unknown> {
  const tracker = new ChangeTracker(workspaceRoot);
  return {
    kind: "changes_summary",
    ...await tracker.summarizeLatest()
  };
}

export async function revertChangesTool(_input: Record<string, unknown>, workspaceRoot: string): Promise<unknown> {
  const tracker = new ChangeTracker(workspaceRoot);
  return {
    kind: "revert_changes",
    ...await tracker.revertLatest()
  };
}

export async function riskAnalyzeTool(input: Record<string, unknown>): Promise<unknown> {
  const command = typeof input["command"] === "string" ? input["command"] : "";
  if (!command.trim()) {
    throw new Error("invalid_tool_input: 'command' must be a non-empty string");
  }
  return {
    kind: "command_risk",
    ...analyzeCommandRisk(command)
  };
}

async function runGit(args: string[], cwd: string): Promise<{
  isGitRepo: boolean;
  code: number;
  stdout: string;
  stderr: string;
  message?: string;
}> {
  return await new Promise((resolve) => {
    const child = spawn("git", args, { cwd, windowsHide: true });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf8");
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });
    child.on("error", (error) => {
      resolve({
        isGitRepo: false,
        code: 1,
        stdout,
        stderr: error.message,
        message: error.message
      });
    });
    child.on("close", (code) => {
      const exitCode = code ?? 1;
      const notRepo = /not a git repository/i.test(stderr);
      resolve({
        isGitRepo: !notRepo && exitCode === 0,
        code: exitCode,
        stdout,
        stderr,
        ...(notRepo ? { message: "current workspace is not a git repository" } : {})
      });
    });
  });
}

function parseStatus(stdout: string): Array<{ path: string; status: string }> {
  return stdout
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => ({
      status: line.slice(0, 2).trim() || "modified",
      path: line.slice(3).trim()
    }));
}

function summarizeDiff(diff: string): { files: number; additions: number; deletions: number; lines: number } {
  const lines = diff.split(/\r?\n/).filter(Boolean);
  const files = lines.filter((line) => line.startsWith("diff --git ")).length;
  const additions = lines.filter((line) => line.startsWith("+") && !line.startsWith("+++")).length;
  const deletions = lines.filter((line) => line.startsWith("-") && !line.startsWith("---")).length;
  return { files, additions, deletions, lines: lines.length };
}
