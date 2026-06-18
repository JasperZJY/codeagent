import { constants } from "node:fs";
import { access, cp, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { WorkspacePathScope } from "./pathScope.js";
import { isSensitivePath } from "./security.js";

export interface AgentSkill {
  name: string;
  description: string;
  triggers: string[];
  tools: string[];
  risk: "low" | "medium" | "high";
  path: string;
  source: "workspace" | "builtin";
  body: string;
}

export interface SkillMatch {
  skill: AgentSkill;
  score: number;
  reason: string;
}

export async function listSkills(workspaceRoot: string): Promise<AgentSkill[]> {
  const skills = new Map<string, AgentSkill>();
  for (const root of await skillRoots(workspaceRoot)) {
    for (const skill of await readSkillsFromRoot(root.path, root.source)) {
      if (root.source === "workspace" || !skills.has(skill.name)) {
        skills.set(skill.name, skill);
      }
    }
  }
  return [...skills.values()].sort((left, right) => left.name.localeCompare(right.name));
}

export async function searchSkills(workspaceRoot: string, query: string): Promise<SkillMatch[]> {
  const normalized = query.toLowerCase();
  return (await listSkills(workspaceRoot))
    .map((skill) => scoreSkill(skill, normalized))
    .filter((match) => match.score > 0)
    .sort((left, right) => right.score - left.score || left.skill.name.localeCompare(right.skill.name));
}

export async function matchSkillsForPrompt(
  workspaceRoot: string,
  prompt: string,
  limit = 3
): Promise<SkillMatch[]> {
  return (await searchSkills(workspaceRoot, prompt)).filter((match) => match.score >= 15).slice(0, limit);
}

export async function readSkill(workspaceRoot: string, name: string): Promise<AgentSkill> {
  const safeName = normalizeSkillName(name);
  const skill = (await listSkills(workspaceRoot)).find((entry) => entry.name === safeName);
  if (!skill) {
    throw new Error(`skill_not_found: ${safeName}`);
  }
  if (isSensitivePath(skill.path)) {
    throw new Error(`sensitive_path_blocked: ${skill.path}`);
  }
  return skill;
}

export async function useSkill(workspaceRoot: string, name: string): Promise<{ skill: AgentSkill; workflow: string }> {
  const skill = await readSkill(workspaceRoot, name);
  return {
    skill,
    workflow: extractSection(skill.body, "Workflow") || skill.body
  };
}

export async function createSkill(workspaceRoot: string, name: string): Promise<AgentSkill> {
  const safeName = normalizeSkillName(name);
  const dir = workspaceSkillDir(workspaceRoot, safeName);
  const file = path.join(dir, "SKILL.md");
  const scope = WorkspacePathScope.fromRoot(workspaceRoot).validatePath(file, workspaceRoot);
  if (!scope.allowed) {
    throw new Error(scope.reason);
  }
  await mkdir(path.join(dir, "scripts"), { recursive: true });
  await mkdir(path.join(dir, "templates"), { recursive: true });
  await mkdir(path.join(dir, "examples"), { recursive: true });
  await writeFile(file, skillTemplate(safeName), "utf8");
  return await readSkill(workspaceRoot, safeName);
}

export async function initializeBuiltinSkills(workspaceRoot: string): Promise<{ created: string[]; skipped: string[]; path: string }> {
  const targetRoot = path.join(workspaceRoot, ".code-agent", "skills");
  await mkdir(targetRoot, { recursive: true });
  const created: string[] = [];
  const skipped: string[] = [];
  const builtin = builtinSkillRoot(workspaceRoot);
  for (const skill of await readSkillsFromRoot(builtin, "builtin")) {
    const target = workspaceSkillDir(workspaceRoot, skill.name);
    if (await exists(path.join(target, "SKILL.md"))) {
      skipped.push(skill.name);
      continue;
    }
    await cp(path.dirname(skill.path), target, { recursive: true, errorOnExist: false });
    created.push(skill.name);
  }
  return { created, skipped, path: targetRoot };
}

export function buildSkillsContext(matches: SkillMatch[]): string {
  if (matches.length === 0) {
    return "";
  }
  return [
    "Loaded skills:",
    ...matches.map((match) => {
      const skill = match.skill;
      const tools = skill.tools.length ? skill.tools.join(", ") : "none";
      return [
        `- ${skill.name}: ${skill.description}`,
        `  triggers: ${skill.triggers.join(", ") || "none"}`,
        `  tools: ${tools}`,
        `  risk: ${skill.risk}`,
        `  workflow: ${extractSection(skill.body, "Workflow").replace(/\s+/g, " ").trim().slice(0, 700)}`
      ].join("\n");
    })
  ].join("\n");
}

async function skillRoots(workspaceRoot: string): Promise<Array<{ path: string; source: "workspace" | "builtin" }>> {
  return [
    { path: builtinSkillRoot(workspaceRoot), source: "builtin" },
    { path: path.join(workspaceRoot, ".code-agent", "skills"), source: "workspace" }
  ];
}

async function readSkillsFromRoot(root: string, source: "workspace" | "builtin"): Promise<AgentSkill[]> {
  if (!(await exists(root))) {
    return [];
  }
  const entries = await readdir(root, { withFileTypes: true });
  const skills: AgentSkill[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }
    const file = path.join(root, entry.name, "SKILL.md");
    if (!(await exists(file))) {
      continue;
    }
    const raw = await readFile(file, "utf8");
    skills.push(parseSkill(raw, file, source));
  }
  return skills;
}

function parseSkill(raw: string, file: string, source: "workspace" | "builtin"): AgentSkill {
  const frontmatter = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  const metadata = frontmatter ? parseFrontmatter(frontmatter[1] ?? "") : {};
  const body = frontmatter ? raw.slice(frontmatter[0].length) : raw;
  const inferredName = path.basename(path.dirname(file));
  return {
    name: normalizeSkillName(stringValue(metadata["name"]) || inferredName),
    description: stringValue(metadata["description"]) || "",
    triggers: arrayValue(metadata["triggers"]),
    tools: arrayValue(metadata["tools"]),
    risk: normalizeRisk(stringValue(metadata["risk"])),
    path: file,
    source,
    body
  };
}

function parseFrontmatter(value: string): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  let currentKey = "";
  for (const line of value.split(/\r?\n/)) {
    const keyValue = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (keyValue) {
      currentKey = keyValue[1] ?? "";
      const raw = keyValue[2] ?? "";
      result[currentKey] = raw ? raw.replace(/^["']|["']$/g, "") : [];
      continue;
    }
    const listItem = line.match(/^\s*-\s*(.+)$/);
    if (listItem && currentKey) {
      const previous = Array.isArray(result[currentKey]) ? result[currentKey] as string[] : [];
      result[currentKey] = [...previous, (listItem[1] ?? "").trim()];
    }
  }
  return result;
}

function scoreSkill(skill: AgentSkill, normalizedQuery: string): SkillMatch {
  const queryWords = normalizedQuery.match(/[a-z0-9_-]+|[\u4e00-\u9fff]+/gi) ?? [];
  let score = 0;
  const reasons: string[] = [];
  if (normalizedQuery.includes(skill.name.toLowerCase())) {
    score += 40;
    reasons.push("name");
  }
  for (const trigger of skill.triggers) {
    if (trigger && normalizedQuery.includes(trigger.toLowerCase())) {
      score += 20;
      reasons.push(`trigger:${trigger}`);
    }
  }
  const haystack = `${skill.description} ${skill.body}`.toLowerCase();
  for (const word of queryWords) {
    if (word.length > 1 && haystack.includes(word.toLowerCase())) {
      score += 2;
    }
  }
  return { skill, score, reason: reasons.join(", ") || "content match" };
}

function normalizeSkillName(value: string): string {
  const normalized = value.trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9_-]{0,80}$/.test(normalized)) {
    throw new Error("invalid_skill_name: use lowercase letters, numbers, dash, or underscore");
  }
  return normalized;
}

function workspaceSkillDir(workspaceRoot: string, name: string): string {
  return path.join(workspaceRoot, ".code-agent", "skills", name);
}

function builtinSkillRoot(_workspaceRoot: string): string {
  return path.join(process.cwd(), "src", "skills", "builtin");
}

async function exists(file: string): Promise<boolean> {
  try {
    await access(file, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function arrayValue(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map(String).map((item) => item.trim()).filter(Boolean);
  }
  if (typeof value === "string" && value.trim()) {
    return [value.trim()];
  }
  return [];
}

function normalizeRisk(value: string): "low" | "medium" | "high" {
  return value === "low" || value === "high" ? value : "medium";
}

function extractSection(markdown: string, title: string): string {
  const lines = markdown.split(/\r?\n/);
  const wanted = title.trim().toLowerCase();
  const start = lines.findIndex((line) => line.replace(/^##\s+/, "").trim().toLowerCase() === wanted);
  if (start < 0) {
    return "";
  }
  const body: string[] = [];
  for (const line of lines.slice(start + 1)) {
    if (/^##\s+/.test(line)) {
      break;
    }
    body.push(line);
  }
  return body.join("\n").trim();
}

function skillTemplate(name: string): string {
  return [
    "---",
    `name: ${name}`,
    "description: Describe when this reusable workflow should be used.",
    "triggers:",
    `  - ${name}`,
    "tools:",
    "  - read_file",
    "risk: medium",
    "---",
    "",
    `# Skill: ${name}`,
    "",
    "## When to use",
    "",
    "Use this skill when the task matches the trigger conditions.",
    "",
    "## Workflow",
    "",
    "1. Inspect relevant context.",
    "2. Execute only permitted tools.",
    "3. Verify results.",
    "4. Summarize observable actions and limitations.",
    "",
    "## Output",
    "",
    "- Files inspected or changed",
    "- Commands or tools used",
    "- Result",
    "- Risks or next steps",
    ""
  ].join("\n");
}
