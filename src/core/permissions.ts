import type { PermissionDecision, PermissionMode, PermissionRequest, ToolSpec } from "./types.js";
import { WorkspacePathScope } from "./pathScope.js";

const permissionRank: Record<PermissionMode, number> = {
  "read-only": 0,
  "workspace-write": 1,
  "danger-full-access": 2
};

export interface ToolAuthorizationContext {
  permissionMode: PermissionMode;
  workspaceRoot: string;
  cwd?: string;
  checkpointId?: string;
}

export function authorizeTool(
  spec: ToolSpec,
  input: unknown,
  context: ToolAuthorizationContext
): PermissionDecision {
  const request: PermissionRequest = {
    toolName: spec.name,
    input,
    activeMode: context.permissionMode,
    requiredMode: spec.requiredPermission
  };

  if (permissionRank[request.activeMode] < permissionRank[request.requiredMode]) {
    return {
      allowed: false,
      reason: `tool '${request.toolName}' requires ${request.requiredMode}; active mode is ${request.activeMode}`
    };
  }

  const scopeDecision = validateWorkspaceScope(spec.name, input, context);
  if (!scopeDecision.allowed) {
    return { allowed: false, reason: scopeDecision.reason };
  }

  return { allowed: true, reason: "allowed" };
}

function validateWorkspaceScope(
  toolName: string,
  input: unknown,
  context: ToolAuthorizationContext
): PermissionDecision {
  const scope = WorkspacePathScope.fromRoot(context.workspaceRoot);
  const objectInput = asRecord(input);

  if (toolName === "shell") {
    const command = typeof objectInput["command"] === "string" ? objectInput["command"] : "";
    const decision = scope.validatePayload(command, context.cwd ?? context.workspaceRoot);
    return { allowed: decision.allowed, reason: decision.reason };
  }

  for (const key of ["path", "newPath", "from", "to", "source", "destination"]) {
    const pathValue = objectInput[key];
    if (typeof pathValue !== "string") {
      continue;
    }
    const decision = scope.validatePath(pathValue, context.cwd ?? context.workspaceRoot);
    if (!decision.allowed) {
      return { allowed: false, reason: decision.reason };
    }
  }

  return { allowed: true, reason: "workspace path scope not required" };
}

function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
