import type { ParsedSlashCommand, SlashCommandName } from "./slash.js";
import type { SlashCommandContext, SlashCommandResult } from "./slashResult.js";

export interface SlashCommandHandler {
  name: SlashCommandName;
  usage: string;
  description: string;
  subcommands?: string[];
  execute: (command: ParsedSlashCommand, context: SlashCommandContext) => Promise<SlashCommandResult> | SlashCommandResult;
}

export class SlashCommandRegistry {
  private readonly handlers = new Map<SlashCommandName, SlashCommandHandler>();

  register(handler: SlashCommandHandler): void {
    this.handlers.set(handler.name, handler);
  }

  get(name: SlashCommandName): SlashCommandHandler | undefined {
    return this.handlers.get(name);
  }

  list(): SlashCommandHandler[] {
    return [...this.handlers.values()].sort((left, right) => left.name.localeCompare(right.name));
  }

  names(): SlashCommandName[] {
    return this.list().map((handler) => handler.name);
  }
}
