import test from "node:test";
import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import { constants } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { buildSkillsContext, initializeBuiltinSkills, listSkills, matchSkillsForPrompt, readSkill, searchSkills } from "../src/core/skills.js";
import { executeTool } from "../src/tools/registry.js";

test("skill_list includes built-in skills", async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), "code-agent-skills-"));
  const skills = await listSkills(workspace);
  assert.ok(skills.some((skill) => skill.name === "python-data-analysis"));
  assert.ok(skills.some((skill) => skill.name === "terminal-ui-polish"));
});

test("skill_search finds python-data-analysis by trigger", async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), "code-agent-skills-search-"));
  const matches = await searchSkills(workspace, "write a python script to count files");
  assert.equal(matches[0]?.skill.name, "python-data-analysis");
});

test("skill_read and skill_use expose workflow without bypassing tools", async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), "code-agent-skills-read-"));
  const skill = await readSkill(workspace, "python-data-analysis");
  assert.match(skill.body, /Workflow/);

  const used = await executeTool(
    "skill_use",
    { name: "python-data-analysis" },
    { permissionMode: "read-only", workspaceRoot: workspace }
  );
  assert.equal(used.ok, true);
  assert.match(JSON.stringify(used.output), /python_write_and_run/);
});

test("unmatched prompt does not load a skill", async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), "code-agent-skills-none-"));
  const matches = await matchSkillsForPrompt(workspace, "hello");
  assert.equal(matches.length, 0);
});

test("path-like filenames do not trigger test-fix skill by token accident", async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), "code-agent-skills-path-noise-"));
  const matches = await matchSkillsForPrompt(workspace, "delete tmp_secret_test.txt");
  assert.equal(matches.some((match) => match.skill.name === "test-fix-loop"), false);
  assert.equal(matches.length, 0);
});

test("skill catalog context does not inject full workflow by default", async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), "code-agent-skills-catalog-"));
  const matches = await matchSkillsForPrompt(workspace, "write a python script to count files");
  const context = buildSkillsContext(matches);
  assert.match(context, /catalog only/);
  assert.doesNotMatch(context, /workflow:/i);
  assert.doesNotMatch(context, /step-by-step/i);
});

test("skills init creates built-in skill files in workspace", async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), "code-agent-skills-init-"));
  const result = await initializeBuiltinSkills(workspace);
  assert.ok(result.created.includes("python-data-analysis"));
  const target = path.join(workspace, ".code-agent", "skills", "python-data-analysis", "SKILL.md");
  await access(target, constants.F_OK);
  assert.match(await readFile(target, "utf8"), /Python Data Analysis/);
});

test("skill_create rejects traversal-style names", async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), "code-agent-skills-safe-"));
  const result = await executeTool(
    "skill_create",
    { name: "../escape" },
    { permissionMode: "workspace-write", workspaceRoot: workspace }
  );
  assert.equal(result.ok, false);
  assert.match(String(result.output), /invalid_skill_name/);
});
