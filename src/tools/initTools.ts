import { initializeProject } from "../core/projectInit.js";

export async function projectInitTool(_input: Record<string, unknown>, workspaceRoot: string): Promise<unknown> {
  return {
    kind: "project_init",
    result: await initializeProject(workspaceRoot)
  };
}
