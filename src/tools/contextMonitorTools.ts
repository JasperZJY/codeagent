import { loadRuntimeConfig } from "../core/config.js";
import { buildContextMonitorReport } from "../core/contextMonitor.js";
import { buildResumeState } from "../core/resumeState.js";
import { SessionStore } from "../core/session.js";
import type { RuntimeConfig } from "../core/types.js";

export async function contextMonitorTool(_input: Record<string, unknown>, workspaceRoot: string): Promise<unknown> {
  const config = loadRuntimeConfig({ workspaceRoot });
  const store = new SessionStore(workspaceRoot);
  const latest = (await store.list())[0];
  const session = latest ? await store.load(latest.sessionId) : await store.loadOrCreate(undefined, config.model);
  if (!session) {
    throw new Error("session_not_found");
  }
  return {
    kind: "context_monitor",
    report: await buildContextMonitorReport(config, session)
  };
}

export async function resumeStateTool(_input: Record<string, unknown>, workspaceRoot: string): Promise<unknown> {
  return {
    kind: "resume_state",
    state: await buildResumeState(workspaceRoot)
  };
}

export async function contextMonitorForRuntime(config: RuntimeConfig, session: Awaited<ReturnType<SessionStore["loadOrCreate"]>>): Promise<unknown> {
  return {
    kind: "context_monitor",
    report: await buildContextMonitorReport(config, session)
  };
}
