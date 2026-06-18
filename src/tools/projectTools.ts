import { buildProjectCommandProfile } from "../core/commandProfile.js";

export async function projectProfileTool(_input: Record<string, unknown>, workspaceRoot: string): Promise<unknown> {
  return {
    kind: "project_profile",
    profile: await buildProjectCommandProfile(workspaceRoot)
  };
}
