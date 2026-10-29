import { createDefaultSlashHandlers } from "./slashHandlers.js";
import type { ParsedSlashCommand, SlashCommandName } from "./slash.js";
import { SlashCommandRegistry } from "./slashRegistry.js";
import type { SlashCommandContext, SlashCommandResult } from "./slashResult.js";

const registry = new SlashCommandRegistry();
for (const handler of createDefaultSlashHandlers()) {
  registry.register(handler);
}

export function registeredSlashCommands(): SlashCommandName[] {
  return registry.names();
}

export async function dispatchSlashCommand(
  command: ParsedSlashCommand,
  context: SlashCommandContext
): Promise<SlashCommandResult> {
  try {
    if (command.name === "unknown") {
      return {
        config: context.config,
        runtime: context.runtime,
        output: renderUnknownSlashCommand(command.rawName)
      };
    }
    const handler = registry.get(command.name);
    if (!handler) {
      return {
        config: context.config,
        runtime: context.runtime,
        output: `Command /${command.name} is parsed but has no registered handler.`
      };
    }
    return await handler.execute(command, context);
  } catch (error) {
    return {
      config: context.config,
      runtime: context.runtime,
      output: `error: ${errorMessage(error)}`
    };
  }
}

function renderUnknownSlashCommand(rawName: string): string {
  if (!rawName.trim()) {
    return "No slash command entered. Type /help to list available commands.";
  }
  return `Unknown command: /${rawName}. Type /help to list available commands.`;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
