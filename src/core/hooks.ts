import { ChangeTracker, type MutationSnapshot } from "./changeTracker.js";
import { authorizeTool } from "./permissions.js";
import { analyzeCommandRisk, isSensitivePath, redactSensitiveData, redactSensitiveText } from "./security.js";
import type { ToolDefinition, ToolExecution, ToolHandlerContext } from "./types.js";

export type HookEvent = "preToolUse" | "postToolUse" | "onToolError" | "onTurnStart" | "onTurnEnd";

export type HookAction = "allow" | "deny" | "ask" | "modify" | "observe";

export interface HookResult {
  ok: boolean;
  action?: HookAction;
  reason?: string;
  modifiedInput?: Record<string, unknown>;
  modifiedOutput?: unknown;
  observations?: unknown[];
}

export interface HookContext {
  tool: ToolDefinition;
  input: Record<string, unknown>;
  authorization: ToolHandlerContext;
  state: Record<string, unknown>;
}

export type PreToolUseHook = (context: HookContext) => Promise<HookResult | void> | HookResult | void;
export type PostToolUseHook = (context: HookContext, execution: ToolExecution) => Promise<HookResult | void> | HookResult | void;
export type ToolErrorHook = (context: HookContext, error: unknown) => Promise<HookResult | void> | HookResult | void;
export type TurnHook = (context: Record<string, unknown>) => Promise<HookResult | void> | HookResult | void;

export class HookManager {
  private readonly preToolUseHooks: PreToolUseHook[] = [];
  private readonly postToolUseHooks: PostToolUseHook[] = [];
  private readonly toolErrorHooks: ToolErrorHook[] = [];
  private readonly turnStartHooks: TurnHook[] = [];
  private readonly turnEndHooks: TurnHook[] = [];

  register(event: "preToolUse", hook: PreToolUseHook): void;
  register(event: "postToolUse", hook: PostToolUseHook): void;
  register(event: "onToolError", hook: ToolErrorHook): void;
  register(event: "onTurnStart" | "onTurnEnd", hook: TurnHook): void;
  register(event: HookEvent, hook: PreToolUseHook | PostToolUseHook | ToolErrorHook | TurnHook): void {
    if (event === "preToolUse") {
      this.preToolUseHooks.push(hook as PreToolUseHook);
    } else if (event === "postToolUse") {
      this.postToolUseHooks.push(hook as PostToolUseHook);
    } else if (event === "onToolError") {
      this.toolErrorHooks.push(hook as ToolErrorHook);
    } else if (event === "onTurnStart") {
      this.turnStartHooks.push(hook as TurnHook);
    } else {
      this.turnEndHooks.push(hook as TurnHook);
    }
  }

  async runPreToolUse(context: HookContext): Promise<HookResult> {
    let currentInput = context.input;
    for (const hook of this.preToolUseHooks) {
      const result = await hook({ ...context, input: currentInput });
      if (!result) {
        continue;
      }
      if (!result.ok || result.action === "deny" || result.action === "ask") {
        return result;
      }
      if (result.action === "modify" && result.modifiedInput) {
        currentInput = result.modifiedInput;
      }
    }
    return { ok: true, action: "allow", modifiedInput: currentInput };
  }

  async runPostToolUse(context: HookContext, execution: ToolExecution): Promise<ToolExecution> {
    let current = execution;
    for (const hook of this.postToolUseHooks) {
      const result = await hook(context, current);
      if (!result) {
        continue;
      }
      if (result.modifiedInput) {
        current = { ...current, input: result.modifiedInput };
      }
      if (Object.hasOwn(result, "modifiedOutput")) {
        current = { ...current, output: result.modifiedOutput };
      }
      if (!result.ok && result.reason) {
        current = { ...current, ok: false, output: result.reason };
      }
    }
    return current;
  }

  async runToolError(context: HookContext, error: unknown): Promise<HookResult | undefined> {
    let latest: HookResult | undefined;
    for (const hook of this.toolErrorHooks) {
      latest = await hook(context, error) ?? latest;
    }
    return latest;
  }

  async runTurnStart(context: Record<string, unknown>): Promise<void> {
    for (const hook of this.turnStartHooks) {
      await hook(context);
    }
  }

  async runTurnEnd(context: Record<string, unknown>): Promise<void> {
    for (const hook of this.turnEndHooks) {
      await hook(context);
    }
  }
}

export function createDefaultHookManager(): HookManager {
  const hooks = new HookManager();
  hooks.register("preToolUse", permissionHook);
  hooks.register("preToolUse", mutationSnapshotHook);
  hooks.register("preToolUse", commandRiskHook);
  hooks.register("preToolUse", sensitivePathHook);
  hooks.register("postToolUse", mutationRecordHook);
  hooks.register("postToolUse", redactionHook);
  hooks.register("onToolError", errorRedactionHook);
  return hooks;
}

export function permissionHook(context: HookContext): HookResult {
  const decision = authorizeTool(context.tool, context.input, context.authorization);
  if (!decision.allowed) {
    return { ok: false, action: "deny", reason: redactSensitiveText(decision.reason) };
  }
  return { ok: true, action: "allow" };
}

export async function mutationSnapshotHook(context: HookContext): Promise<HookResult | void> {
  const paths = mutationPaths(context.tool.name, context.input);
  if (paths.length === 0) {
    return;
  }
  const tracker = new ChangeTracker(context.authorization.workspaceRoot);
  context.state["mutationTracker"] = tracker;
  context.state["mutations"] = await Promise.all(
    paths.map((filePath) =>
      tracker.snapshotBeforeMutation(
        context.authorization.checkpointId,
        filePath,
        context.tool.name
      )
    )
  );
}

export function commandRiskHook(context: HookContext): HookResult | void {
  if (context.tool.name !== "shell") {
    return;
  }
  const command = typeof context.input["command"] === "string" ? context.input["command"] : "";
  const report = analyzeCommandRisk(command);
  if (!report.blocked) {
    return;
  }
  return {
    ok: false,
    action: "deny",
    reason: "Command blocked by safety policy. Use /risk to inspect it; destructive and credential-risk commands require an explicit safer workflow.",
    observations: [{ kind: "command_risk_blocked", ...report }]
  };
}

export function sensitivePathHook(context: HookContext): HookResult | void {
  if (!["read_file", "write_file", "edit_file", "delete_file", "move_file", "file_exists"].includes(context.tool.name)) {
    return;
  }
  const blocked = pathInputs(context.input).find((filePath) => isSensitivePath(filePath));
  if (!blocked) {
    return;
  }
  return {
    ok: false,
    action: "deny",
    reason: "Sensitive files such as .env, SSH keys, cookies, and credential stores are not read by default.",
    observations: [{ kind: "sensitive_path_blocked", path: blocked }]
  };
}

export async function mutationRecordHook(context: HookContext): Promise<void> {
  const tracker = context.state["mutationTracker"];
  const mutations = context.state["mutations"];
  if (tracker instanceof ChangeTracker && Array.isArray(mutations)) {
    for (const mutation of mutations) {
      await tracker.recordAfterMutation(mutation as MutationSnapshot);
    }
  }
}

export function redactionHook(_context: HookContext, execution: ToolExecution): HookResult {
  return {
    ok: true,
    action: "modify",
    modifiedInput: redactSensitiveData(execution.input) as Record<string, unknown>,
    modifiedOutput: redactSensitiveData(execution.output)
  };
}

export function errorRedactionHook(_context: HookContext, error: unknown): HookResult {
  const message = error instanceof Error ? error.message : String(error);
  return { ok: false, action: "observe", reason: redactSensitiveText(message) };
}

function mutationPaths(toolName: string, input: Record<string, unknown>): string[] {
  if (!["write_file", "edit_file", "delete_file", "move_file"].includes(toolName)) {
    return [];
  }
  const paths = pathInputs(input);
  if (toolName === "move_file") {
    return paths;
  }
  return paths.slice(0, 1);
}

function pathInputs(input: Record<string, unknown>): string[] {
  return ["path", "newPath", "from", "to", "source", "destination"]
    .map((key) => input[key])
    .filter((value): value is string => typeof value === "string" && value.length > 0);
}
