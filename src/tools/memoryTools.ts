import { MemoryStore } from "../core/memory.js";

export async function memorySearchTool(input: Record<string, unknown>, workspaceRoot: string): Promise<unknown> {
  const query = typeof input["query"] === "string" ? input["query"] : "";
  const limit = typeof input["limit"] === "number" ? Math.max(1, Math.min(20, Math.floor(input["limit"]))) : 8;
  return {
    kind: "memory_search",
    query,
    matches: await new MemoryStore(workspaceRoot).search(query, limit)
  };
}

export async function memoryWriteTool(input: Record<string, unknown>, workspaceRoot: string): Promise<unknown> {
  const text = requireString(input, "text");
  const type = normalizeType(typeof input["type"] === "string" ? input["type"] : "lesson");
  const tags = Array.isArray(input["tags"])
    ? input["tags"].filter((tag): tag is string => typeof tag === "string")
    : [];
  const entry = await new MemoryStore(workspaceRoot).append({
    type,
    text,
    tags,
    source: "tool"
  });
  return {
    kind: "memory_write",
    entry
  };
}

function normalizeType(value: string): "preference" | "project_fact" | "lesson" | "failure" | "success" {
  if (value === "preference" || value === "project_fact" || value === "lesson" || value === "failure" || value === "success") {
    return value;
  }
  return "lesson";
}

function requireString(input: Record<string, unknown>, key: string): string {
  const value = input[key];
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`invalid_tool_input: '${key}' must be a non-empty string`);
  }
  return value.trim();
}
