import { mkdir, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { buildProjectCommandProfile } from "./commandProfile.js";
import { indexCode } from "./codeAnalyzer.js";
import type { ProjectInitResult } from "./types.js";

const INIT_SKIP_DIRS = new Set([".git", "node_modules", "dist", "build", ".code-agent"]);

export async function initializeProject(workspaceRoot: string): Promise<ProjectInitResult> {
  const profile = await buildProjectCommandProfile(workspaceRoot);
  const index = await indexCode(workspaceRoot);
  const tree = await directoryTree(workspaceRoot, workspaceRoot, 2);
  const risks = inferProjectRisks(profile, index.files);
  const codeAgentDir = path.join(workspaceRoot, ".code-agent");
  await mkdir(codeAgentDir, { recursive: true });

  const projectPath = path.join(codeAgentDir, "project.md");
  const rulesPath = path.join(codeAgentDir, "rules.md");
  const commandsPath = path.join(codeAgentDir, "commands.md");

  await writeFile(projectPath, renderProjectMd(profile, tree, index.files, risks), "utf8");
  await writeFile(rulesPath, renderRulesMd(), "utf8");
  await writeFile(commandsPath, renderCommandsMd(profile), "utf8");

  return {
    projectPath,
    rulesPath,
    commandsPath,
    profile,
    outlineFiles: index.files.length,
    risks
  };
}

function renderProjectMd(
  profile: Awaited<ReturnType<typeof buildProjectCommandProfile>>,
  tree: string[],
  indexedFiles: string[],
  risks: string[]
): string {
  return [
    "# Project Profile",
    "",
    "## 技术栈",
    profile.detections.length
      ? profile.detections.map((item) => `- ${item.type}: ${item.file}`).join("\n")
      : "- 未识别到标准项目文件。",
    "",
    "## 目录结构",
    tree.length ? tree.map((entry) => `- ${entry}`).join("\n") : "- 空目录。",
    "",
    "## 语义索引",
    `- Indexed files: ${indexedFiles.length}`,
    "- Cache: `.code-agent/symbols/index.json`",
    "",
    "## 当前项目风险点",
    risks.length ? risks.map((risk) => `- ${risk}`).join("\n") : "- 暂未发现明显初始化风险。",
    ""
  ].join("\n");
}

function renderRulesMd(): string {
  return [
    "# Project Rules",
    "",
    "## 编码规范",
    "- Match the existing TypeScript module style.",
    "- Keep runtime orchestration separate from tool implementations.",
    "- Keep terminal rendering separate from core runtime state.",
    "- Add tests for behavior changes.",
    "",
    "## 禁止修改的目录",
    "- `node_modules/`",
    "- `dist/` except generated build output",
    "- `.git/`",
    "- `.code-agent/sessions/` unless session tooling is being changed",
    "- `.code-agent/checkpoints/` unless checkpoint tooling is being changed",
    "",
    "## 常见任务流程",
    "- Read relevant modules and tests first.",
    "- Update focused core/tool/CLI modules.",
    "- Run `npm run typecheck`, `npm test`, and `python -m py_compile py/agent_bridge.py`.",
    "- Record changes in `TODO.md`.",
    ""
  ].join("\n");
}

function renderCommandsMd(profile: Awaited<ReturnType<typeof buildProjectCommandProfile>>): string {
  const commands = profile.commands;
  return [
    "# Project Commands",
    "",
    "## 启动命令",
    `- ${commands.dev ?? "unavailable"}`,
    "",
    "## 测试命令",
    `- ${commands.test ?? "unavailable"}`,
    "",
    "## 构建命令",
    `- ${commands.build ?? "unavailable"}`,
    "",
    "## 类型检查",
    `- ${commands.typecheck ?? "unavailable"}`,
    "",
    "## Lint",
    `- ${commands.lint ?? "unavailable"}`,
    "",
    "## 验证建议",
    "- `npm run typecheck`",
    "- `npm test`",
    "- `python -m py_compile py/agent_bridge.py`",
    ""
  ].join("\n");
}

async function directoryTree(root: string, current: string, maxDepth: number, depth = 0): Promise<string[]> {
  if (depth > maxDepth) {
    return [];
  }
  const entries = await readdir(current, { withFileTypes: true });
  const lines: string[] = [];
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name)).slice(0, 80)) {
    if (INIT_SKIP_DIRS.has(entry.name)) {
      continue;
    }
    const absolute = path.join(current, entry.name);
    const relative = path.relative(root, absolute).replace(/\\/g, "/");
    lines.push(`${"  ".repeat(depth)}${entry.isDirectory() ? relative + "/" : relative}`);
    if (entry.isDirectory()) {
      lines.push(...await directoryTree(root, absolute, maxDepth, depth + 1));
    }
  }
  return lines;
}

function inferProjectRisks(
  profile: Awaited<ReturnType<typeof buildProjectCommandProfile>>,
  indexedFiles: string[]
): string[] {
  const risks: string[] = [];
  if (!profile.commands.test) {
    risks.push("No test command was inferred.");
  }
  if (!profile.commands.typecheck) {
    risks.push("No typecheck command was inferred.");
  }
  if (indexedFiles.length === 0) {
    risks.push("No code files were indexed.");
  }
  if (profile.warnings.length > 0) {
    risks.push(...profile.warnings);
  }
  return [...new Set(risks)];
}
