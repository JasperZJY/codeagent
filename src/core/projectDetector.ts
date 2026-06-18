import { constants } from "node:fs";
import { access, readFile } from "node:fs/promises";
import path from "node:path";
import type { ProjectDetection } from "./types.js";

export async function detectProjects(workspaceRoot: string): Promise<ProjectDetection[]> {
  const detections: ProjectDetection[] = [];
  const packageJson = await readJsonFile(path.join(workspaceRoot, "package.json"));
  if (packageJson) {
    detections.push({
      type: "node",
      file: "package.json",
      details: {
        scripts: isRecord(packageJson["scripts"]) ? packageJson["scripts"] : {}
      }
    });
  }
  if (await exists(path.join(workspaceRoot, "pyproject.toml"))) {
    detections.push({ type: "python", file: "pyproject.toml" });
  } else if (await exists(path.join(workspaceRoot, "requirements.txt"))) {
    detections.push({ type: "python", file: "requirements.txt" });
  }
  if (await exists(path.join(workspaceRoot, "Makefile"))) {
    detections.push({
      type: "make",
      file: "Makefile",
      details: { targets: await readMakeTargets(path.join(workspaceRoot, "Makefile")) }
    });
  }
  if (await exists(path.join(workspaceRoot, "Cargo.toml"))) {
    detections.push({ type: "rust", file: "Cargo.toml" });
  }
  if (await exists(path.join(workspaceRoot, "pom.xml"))) {
    detections.push({ type: "maven", file: "pom.xml" });
  }
  return detections;
}

async function readJsonFile(filePath: string): Promise<Record<string, unknown> | undefined> {
  if (!(await exists(filePath))) {
    return undefined;
  }
  try {
    const parsed = JSON.parse(await readFile(filePath, "utf8"));
    return isRecord(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

async function readMakeTargets(filePath: string): Promise<string[]> {
  const content = await readFile(filePath, "utf8");
  return content
    .split(/\r?\n/)
    .map((line) => line.match(/^([A-Za-z0-9_.-]+):/)?.[1])
    .filter((target): target is string => Boolean(target));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

async function exists(filePath: string): Promise<boolean> {
  try {
    await access(filePath, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}
