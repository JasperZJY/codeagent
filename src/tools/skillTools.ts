import {
  createSkill,
  initializeBuiltinSkills,
  listSkills,
  readSkill,
  searchSkills,
  useSkill
} from "../core/skills.js";

export async function skillListTool(_input: Record<string, unknown>, workspaceRoot: string): Promise<unknown> {
  const skills = await listSkills(workspaceRoot);
  return {
    skills: skills.map((skill) => ({
      name: skill.name,
      description: skill.description,
      triggers: skill.triggers,
      tools: skill.tools,
      risk: skill.risk,
      source: skill.source,
      path: skill.path
    }))
  };
}

export async function skillSearchTool(input: Record<string, unknown>, workspaceRoot: string): Promise<unknown> {
  const query = requireString(input, "query");
  const matches = await searchSkills(workspaceRoot, query);
  return {
    query,
    matches: matches.map((match) => ({
      name: match.skill.name,
      description: match.skill.description,
      score: match.score,
      reason: match.reason,
      source: match.skill.source,
      path: match.skill.path
    }))
  };
}

export async function skillReadTool(input: Record<string, unknown>, workspaceRoot: string): Promise<unknown> {
  const skill = await readSkill(workspaceRoot, requireString(input, "name"));
  return {
    name: skill.name,
    description: skill.description,
    triggers: skill.triggers,
    tools: skill.tools,
    risk: skill.risk,
    source: skill.source,
    path: skill.path,
    content: skill.body
  };
}

export async function skillUseTool(input: Record<string, unknown>, workspaceRoot: string): Promise<unknown> {
  const result = await useSkill(workspaceRoot, requireString(input, "name"));
  return {
    name: result.skill.name,
    description: result.skill.description,
    triggers: result.skill.triggers,
    tools: result.skill.tools,
    risk: result.skill.risk,
    source: result.skill.source,
    path: result.skill.path,
    workflow: result.workflow
  };
}

export async function skillCreateTool(input: Record<string, unknown>, workspaceRoot: string): Promise<unknown> {
  const skill = await createSkill(workspaceRoot, requireString(input, "name"));
  return { name: skill.name, path: skill.path, created: true };
}

export async function skillReloadTool(_input: Record<string, unknown>, workspaceRoot: string): Promise<unknown> {
  const skills = await listSkills(workspaceRoot);
  return { reloaded: skills.length, skills: skills.map((skill) => skill.name) };
}

export async function skillInitTool(_input: Record<string, unknown>, workspaceRoot: string): Promise<unknown> {
  return await initializeBuiltinSkills(workspaceRoot);
}

function requireString(input: Record<string, unknown>, key: string): string {
  const value = input[key];
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`invalid_tool_input: '${key}' must be a non-empty string`);
  }
  return value.trim();
}
