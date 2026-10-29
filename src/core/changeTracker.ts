import { createHash, randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { access, mkdir, readFile, readdir, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { WorkspacePathScope } from "./pathScope.js";

export interface ChangeCheckpoint {
  version: 1;
  id: string;
  createdAt: string;
  updatedAt: string;
  workspaceRoot: string;
  reason: string;
  sessionId?: string;
  prompt?: string;
  files: CheckpointFile[];
}

export interface CheckpointFile {
  path: string;
  absolutePath: string;
  existedBefore: boolean;
  beforeHash?: string;
  beforeContent?: string;
  afterHash?: string;
  toolName: string;
  recordedAt: string;
  updatedAt?: string;
}

export interface MutationSnapshot {
  checkpointId: string;
  relativePath: string;
  absolutePath: string;
}

export interface ChangesSummary {
  checkpointId?: string;
  files: Array<{
    path: string;
    status: "created" | "modified" | "deleted" | "unchanged" | "unknown";
    toolName: string;
    beforeHash?: string;
    afterHash?: string;
  }>;
}

export interface RevertResult {
  checkpointId?: string;
  reverted: string[];
  skipped: Array<{ path: string; reason: string }>;
}

export class ChangeTracker {
  constructor(private readonly workspaceRoot: string) {}

  async createCheckpoint(input: {
    reason?: string;
    sessionId?: string;
    prompt?: string;
  } = {}): Promise<ChangeCheckpoint> {
    const now = new Date().toISOString();
    const checkpoint: ChangeCheckpoint = {
      version: 1,
      id: randomUUID(),
      createdAt: now,
      updatedAt: now,
      workspaceRoot: path.resolve(this.workspaceRoot),
      reason: input.reason ?? "manual",
      ...(input.sessionId !== undefined ? { sessionId: input.sessionId } : {}),
      ...(input.prompt !== undefined ? { prompt: input.prompt } : {}),
      files: []
    };
    await this.saveCheckpoint(checkpoint);
    await this.writeLatest(checkpoint.id);
    return checkpoint;
  }

  async latestCheckpoint(): Promise<ChangeCheckpoint | undefined> {
    const latest = await this.readLatest();
    if (latest) {
      return await this.loadCheckpoint(latest);
    }
    const dir = this.checkpointDir();
    if (!(await exists(dir))) {
      return undefined;
    }
    const files = (await readdir(dir))
      .filter((entry) => entry.endsWith(".json") && entry !== "latest.json")
      .sort();
    const newest = files.at(-1);
    return newest ? await this.loadCheckpoint(path.basename(newest, ".json")) : undefined;
  }

  async snapshotBeforeMutation(
    checkpointId: string | undefined,
    filePath: string,
    toolName: string
  ): Promise<MutationSnapshot> {
    const checkpoint = checkpointId
      ? await this.loadCheckpoint(checkpointId) ?? await this.createCheckpoint({ reason: "implicit" })
      : await this.createCheckpoint({ reason: "implicit" });
    const absolutePath = this.resolveInWorkspace(filePath);
    const relativePath = this.relativePath(absolutePath);
    const existing = checkpoint.files.find((file) => file.path === relativePath);
    if (!existing) {
      const existedBefore = await exists(absolutePath);
      const beforeContent = existedBefore ? await readFile(absolutePath, "utf8") : undefined;
      checkpoint.files.push({
        path: relativePath,
        absolutePath,
        existedBefore,
        ...(beforeContent !== undefined ? { beforeContent, beforeHash: hashText(beforeContent) } : {}),
        toolName,
        recordedAt: new Date().toISOString()
      });
      checkpoint.updatedAt = new Date().toISOString();
      await this.saveCheckpoint(checkpoint);
    }
    await this.writeLatest(checkpoint.id);
    return { checkpointId: checkpoint.id, relativePath, absolutePath };
  }

  async recordAfterMutation(snapshot: MutationSnapshot): Promise<void> {
    const checkpoint = await this.loadCheckpoint(snapshot.checkpointId);
    if (!checkpoint) {
      return;
    }
    const entry = checkpoint.files.find((file) => file.path === snapshot.relativePath);
    if (!entry) {
      return;
    }
    if (await exists(snapshot.absolutePath)) {
      const afterContent = await readFile(snapshot.absolutePath, "utf8");
      entry.afterHash = hashText(afterContent);
    } else {
      entry.afterHash = hashText("");
    }
    entry.updatedAt = new Date().toISOString();
    checkpoint.updatedAt = new Date().toISOString();
    await this.saveCheckpoint(checkpoint);
    await this.writeLatest(checkpoint.id);
  }

  async summarizeLatest(): Promise<ChangesSummary> {
    const checkpoint = await this.latestCheckpoint();
    if (!checkpoint) {
      return { files: [] };
    }
    return {
      checkpointId: checkpoint.id,
      files: checkpoint.files.map((file) => ({
        path: file.path,
        status: statusForFile(file),
        toolName: file.toolName,
        ...(file.beforeHash !== undefined ? { beforeHash: file.beforeHash } : {}),
        ...(file.afterHash !== undefined ? { afterHash: file.afterHash } : {})
      }))
    };
  }

  async revertLatest(): Promise<RevertResult> {
    const checkpoint = await this.latestCheckpoint();
    if (!checkpoint) {
      return { reverted: [], skipped: [{ path: ".", reason: "no checkpoint available" }] };
    }
    const reverted: string[] = [];
    const skipped: Array<{ path: string; reason: string }> = [];
    for (const file of [...checkpoint.files].reverse()) {
      const currentExists = await exists(file.absolutePath);
      if (!file.afterHash) {
        skipped.push({ path: file.path, reason: "file was not written by this checkpoint" });
        continue;
      }
      if (!currentExists) {
        if (file.existedBefore && file.afterHash === hashText("")) {
          await mkdir(path.dirname(file.absolutePath), { recursive: true });
          await writeFile(file.absolutePath, file.beforeContent ?? "", "utf8");
          reverted.push(file.path);
        } else if (file.existedBefore) {
          skipped.push({ path: file.path, reason: "current file is missing; refusing to recreate unexpectedly" });
        } else {
          reverted.push(file.path);
        }
        continue;
      }
      const current = await readFile(file.absolutePath, "utf8");
      if (hashText(current) !== file.afterHash) {
        skipped.push({ path: file.path, reason: "file changed after agent write; keeping user changes" });
        continue;
      }
      if (file.existedBefore) {
        await mkdir(path.dirname(file.absolutePath), { recursive: true });
        await writeFile(file.absolutePath, file.beforeContent ?? "", "utf8");
      } else {
        await unlink(file.absolutePath);
      }
      reverted.push(file.path);
    }
    return { checkpointId: checkpoint.id, reverted, skipped };
  }

  private async saveCheckpoint(checkpoint: ChangeCheckpoint): Promise<void> {
    await mkdir(this.checkpointDir(), { recursive: true });
    await writeFile(this.checkpointPath(checkpoint.id), JSON.stringify(checkpoint, null, 2), "utf8");
  }

  private async loadCheckpoint(id: string): Promise<ChangeCheckpoint | undefined> {
    const target = this.checkpointPath(id);
    if (!(await exists(target))) {
      return undefined;
    }
    const checkpoint = JSON.parse(await readFile(target, "utf8")) as ChangeCheckpoint;
    if (path.resolve(checkpoint.workspaceRoot) !== path.resolve(this.workspaceRoot)) {
      throw new Error(`checkpoint_workspace_mismatch: ${checkpoint.workspaceRoot}`);
    }
    return checkpoint;
  }

  private async writeLatest(id: string): Promise<void> {
    await mkdir(this.checkpointDir(), { recursive: true });
    await writeFile(path.join(this.checkpointDir(), "latest.json"), JSON.stringify({ id }, null, 2), "utf8");
  }

  private async readLatest(): Promise<string | undefined> {
    const target = path.join(this.checkpointDir(), "latest.json");
    if (!(await exists(target))) {
      return undefined;
    }
    const payload = JSON.parse(await readFile(target, "utf8")) as { id?: string };
    return payload.id;
  }

  private checkpointDir(): string {
    return path.join(this.workspaceRoot, ".code-agent", "checkpoints");
  }

  private checkpointPath(id: string): string {
    return path.join(this.checkpointDir(), `${id}.json`);
  }

  private resolveInWorkspace(value: string): string {
    const decision = WorkspacePathScope.fromRoot(this.workspaceRoot).validatePath(value, this.workspaceRoot);
    if (!decision.allowed) {
      throw new Error(decision.reason);
    }
    return decision.resolved ?? path.resolve(this.workspaceRoot, value);
  }

  private relativePath(absolutePath: string): string {
    return normalizeSlashes(path.relative(this.workspaceRoot, absolutePath));
  }
}

function statusForFile(file: CheckpointFile): ChangesSummary["files"][number]["status"] {
  if (!file.afterHash) {
    return "unknown";
  }
  if (!file.existedBefore) {
    return "created";
  }
  if (file.beforeHash === file.afterHash) {
    return "unchanged";
  }
  return "modified";
}

function hashText(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function normalizeSlashes(value: string): string {
  return value.replace(/\\/g, "/");
}

async function exists(value: string): Promise<boolean> {
  try {
    await access(value, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}
