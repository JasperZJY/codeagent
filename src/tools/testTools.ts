import { buildProjectCommandProfile, selectValidationCommands } from "../core/commandProfile.js";
import { parseErrorLog, formatParsedErrors } from "../core/errorParser.js";

export async function validationPlanTool(_input: Record<string, unknown>, workspaceRoot: string): Promise<unknown> {
  const profile = await buildProjectCommandProfile(workspaceRoot);
  const commands = selectValidationCommands(profile);
  return {
    kind: "validation_plan",
    profile,
    commands,
    warning: commands.length === 0 ? "No validation commands inferred." : undefined
  };
}

export async function parseErrorsTool(input: Record<string, unknown>): Promise<unknown> {
  const output = typeof input["output"] === "string" ? input["output"] : "";
  const command = typeof input["command"] === "string" ? input["command"] : "";
  const errors = parseErrorLog(output, command);
  return {
    kind: "parsed_errors",
    errors,
    summary: formatParsedErrors(errors)
  };
}
