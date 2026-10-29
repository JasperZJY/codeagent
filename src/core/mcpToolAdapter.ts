import type { ToolHandler, ToolRisk } from "./types.js";

export interface ExternalMcpTool {
  name: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
  risk?: ToolRisk;
  handler: ToolHandler;
}

export function mcpToolName(serverName: string, toolName: string): string {
  return `mcp__${normalizeMcpName(serverName)}__${normalizeMcpName(toolName)}`;
}

export function normalizeMcpName(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]/g, "_");
}
