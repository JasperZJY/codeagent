export interface WorktreeRecord {
  name: string;
  path: string;
  taskId?: string;
}

export class WorktreeManager {
  private readonly records = new Map<string, WorktreeRecord>();

  list(): WorktreeRecord[] {
    return Array.from(this.records.values());
  }

  get(name: string): WorktreeRecord | undefined {
    return this.records.get(name);
  }

  remember(record: WorktreeRecord): void {
    this.records.set(record.name, record);
  }
}
