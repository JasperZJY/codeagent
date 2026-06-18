import path from "node:path";
import type { ModelToolAction } from "./planner.js";
import type { ToolExecution } from "./types.js";

export interface RecoveryPlan {
  reason: string;
  actions: ModelToolAction[];
}

export function planRecovery(failedAction: ModelToolAction, execution: ToolExecution): RecoveryPlan | undefined {
  if (execution.ok) {
    return undefined;
  }
  const output = String(execution.output);
  if ((failedAction.tool === "read_file" || failedAction.tool === "list_dir") && /ENOENT|no such file|not found/i.test(output)) {
    const input = failedAction.input;
    const rawPath = typeof input["path"] === "string" ? input["path"] : ".";
    const basename = path.basename(rawPath);
    return {
      reason: `recover missing path ${rawPath}`,
      actions: [
        {
          tool: "list_dir",
          input: { path: safeDirname(rawPath) },
          reason: "inspect nearby directory after missing path"
        },
        {
          tool: "glob_search",
          input: { pattern: `**/${basename}`, path: "." },
          reason: "search workspace for requested filename"
        }
      ]
    };
  }
  if (failedAction.tool === "web_search" && /unconfigured|api key|BAIDU_AI_SEARCH_API_KEY/i.test(output)) {
    return {
      reason: "web search provider is not configured",
      actions: []
    };
  }
  if (/permission|requires .*mode|outside workspace/i.test(output)) {
    return {
      reason: "permission or workspace-scope recovery requires user configuration",
      actions: []
    };
  }
  return undefined;
}

function safeDirname(value: string): string {
  const dirname = path.dirname(value);
  return dirname === "." || dirname === "" ? "." : dirname;
}
