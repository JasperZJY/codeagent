import { indexWorkspace, searchRagTool } from "../core/rag.js";

export async function ragIndexTool(input: Record<string, unknown>, workspaceRoot: string): Promise<unknown> {
  return await indexWorkspace(workspaceRoot, input);
}

export async function ragSearchTool(input: Record<string, unknown>, workspaceRoot: string): Promise<unknown> {
  return await searchRagTool(workspaceRoot, input);
}
