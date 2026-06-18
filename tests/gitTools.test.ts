import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { executeTool } from "../src/tools/registry.js";

const hasGit = spawnSync("git", ["--version"], { encoding: "utf8" }).status === 0;

test("git diff tool summarizes tracked changes", { skip: !hasGit }, async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), "code-agent-git-"));
  git(workspace, ["init"]);
  git(workspace, ["config", "user.email", "test@example.com"]);
  git(workspace, ["config", "user.name", "Code Agent Test"]);
  await writeFile(path.join(workspace, "a.txt"), "hello\n", "utf8");
  git(workspace, ["add", "a.txt"]);
  git(workspace, ["commit", "-m", "init"]);
  await writeFile(path.join(workspace, "a.txt"), "hello\nworld\n", "utf8");

  const diff = await executeTool(
    "git_diff",
    {},
    { permissionMode: "read-only", workspaceRoot: workspace }
  );
  assert.equal(diff.ok, true);
  const output = diff.output as { isGitRepo?: boolean; diff?: string; summary?: { additions?: number } };
  assert.equal(output.isGitRepo, true);
  assert.match(output.diff ?? "", /\+world/);
  assert.equal(output.summary?.additions, 1);

  const status = await executeTool(
    "git_status",
    {},
    { permissionMode: "read-only", workspaceRoot: workspace }
  );
  assert.equal(status.ok, true);
  assert.match(JSON.stringify(status.output), /a\.txt/);
});

test("commit message tool drafts a message from changed files", { skip: !hasGit }, async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), "code-agent-commit-msg-"));
  git(workspace, ["init"]);
  git(workspace, ["config", "user.email", "test@example.com"]);
  git(workspace, ["config", "user.name", "Code Agent Test"]);
  await writeFile(path.join(workspace, "a.txt"), "hello\n", "utf8");
  git(workspace, ["add", "a.txt"]);
  git(workspace, ["commit", "-m", "init"]);
  await writeFile(path.join(workspace, "a.txt"), "hello\nagain\n", "utf8");

  const result = await executeTool(
    "git_commit_message",
    {},
    { permissionMode: "read-only", workspaceRoot: workspace }
  );
  assert.equal(result.ok, true);
  assert.match((result.output as { message?: string }).message ?? "", /^chore: update a\.txt/m);
});

test("git diff tool reports non-git workspaces without throwing", async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), "code-agent-no-git-"));
  const result = await executeTool(
    "git_diff",
    {},
    { permissionMode: "read-only", workspaceRoot: workspace }
  );
  assert.equal(result.ok, true);
  assert.equal((result.output as { isGitRepo?: boolean }).isGitRepo, false);
});

function git(cwd: string, args: string[]): void {
  const result = spawnSync("git", args, { cwd, encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr || result.stdout);
}
