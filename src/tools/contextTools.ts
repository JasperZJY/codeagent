import { retrieveCcrEntry } from "../core/headroom.js";

export async function ccrRetrieveTool(input: Record<string, unknown>, workspaceRoot: string): Promise<unknown> {
  const ref = requireString(input, "ref");
  const query = typeof input["query"] === "string" ? input["query"] : undefined;
  return await retrieveCcrEntry(workspaceRoot, ref, query);
}

function requireString(input: Record<string, unknown>, key: string): string {
  const value = input[key];
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`invalid_tool_input: '${key}' must be a non-empty string`);
  }
  return value.trim();
}
