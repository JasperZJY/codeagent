export type BackgroundTaskStatus = "running" | "completed" | "failed" | "cancelled";

export interface BackgroundTaskRecord {
  id: string;
  toolName: string;
  status: BackgroundTaskStatus;
  startedAt: string;
  completedAt?: string;
  output?: unknown;
}

export class BackgroundTaskManager {
  private readonly tasks = new Map<string, BackgroundTaskRecord>();

  list(): BackgroundTaskRecord[] {
    return Array.from(this.tasks.values());
  }

  get(id: string): BackgroundTaskRecord | undefined {
    return this.tasks.get(id);
  }

  register(record: BackgroundTaskRecord): void {
    this.tasks.set(record.id, record);
  }
}
