import { existsSync } from "node:fs";
import { writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { detectProjects } from "./projectDetector.js";
import type { ProjectCommandProfile, ProjectDetection } from "./types.js";

type CommandKind = keyof ProjectCommandProfile["commands"];

export async function buildProjectCommandProfile(workspaceRoot: string): Promise<ProjectCommandProfile> {
  const detections = await detectProjects(workspaceRoot);
  const commands: ProjectCommandProfile["commands"] = {};
  const warnings: string[] = [];

  for (const detection of detections) {
    applyDetection(workspaceRoot, detection, commands, warnings);
  }

  if (detections.length === 0) {
    warnings.push("No known project files found.");
  }
  if (!commands.typecheck && !commands.test && !commands.lint && !commands.build) {
    warnings.push("No non-interactive validation command could be inferred.");
  }

  const profile: ProjectCommandProfile = {
    workspaceRoot,
    detections,
    commands,
    warnings,
    updatedAt: new Date().toISOString()
  };
  await persistProfile(workspaceRoot, profile);
  return profile;
}

export function selectValidationCommands(profile: ProjectCommandProfile): string[] {
  return [
    profile.commands.typecheck,
    profile.commands.lint,
    profile.commands.test,
    profile.commands.build
  ].filter((command): command is string => Boolean(command));
}

function applyDetection(
  workspaceRoot: string,
  detection: ProjectDetection,
  commands: ProjectCommandProfile["commands"],
  warnings: string[]
): void {
  if (detection.type === "node") {
    const scripts = readScripts(detection);
    setScript(commands, scripts, "typecheck");
    setScript(commands, scripts, "lint");
    setScript(commands, scripts, "test");
    setScript(commands, scripts, "build");
    setScript(commands, scripts, "dev");
    if (!commands.typecheck && existsSync(path.join(workspaceRoot, "tsconfig.json"))) {
      commands.typecheck = "npx tsc -p tsconfig.json --noEmit";
    }
    return;
  }

  if (detection.type === "python") {
    commands.test ??= "python -m pytest";
    if (detection.file === "pyproject.toml") {
      commands.build ??= "python -m build";
    }
    return;
  }

  if (detection.type === "make") {
    const targets = readTargets(detection);
    for (const kind of ["typecheck", "lint", "test", "build", "dev"] as CommandKind[]) {
      if (!commands[kind] && targets.includes(kind)) {
        commands[kind] = `make ${kind}`;
      }
    }
    return;
  }

  if (detection.type === "rust") {
    commands.typecheck ??= "cargo check";
    commands.test ??= "cargo test";
    commands.build ??= "cargo build";
    return;
  }

  if (detection.type === "maven") {
    commands.test ??= "mvn test";
    commands.build ??= "mvn package";
    warnings.push("Maven lint/typecheck commands were not inferred.");
  }
}

function setScript(commands: ProjectCommandProfile["commands"], scripts: Record<string, unknown>, kind: CommandKind): void {
  const script = scripts[kind];
  if (typeof script === "string" && script.trim()) {
    commands[kind] = kind === "test" ? "npm test" : `npm run ${kind}`;
  }
}

function readScripts(detection: ProjectDetection): Record<string, unknown> {
  const scripts = detection.details?.["scripts"];
  return scripts && typeof scripts === "object" && !Array.isArray(scripts)
    ? scripts as Record<string, unknown>
    : {};
}

function readTargets(detection: ProjectDetection): string[] {
  const targets = detection.details?.["targets"];
  return Array.isArray(targets) ? targets.filter((target): target is string => typeof target === "string") : [];
}

async function persistProfile(workspaceRoot: string, profile: ProjectCommandProfile): Promise<void> {
  const directory = path.join(workspaceRoot, ".code-agent");
  await mkdir(directory, { recursive: true });
  await writeFile(path.join(directory, "project-profile.json"), `${JSON.stringify(profile, null, 2)}\n`, "utf8");
}
