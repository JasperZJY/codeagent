import type { CommandSpec } from "./types.js";

export const commandCatalog: CommandSpec[] = [
  {
    name: "interactive",
    aliases: ["repl"],
    description: "Start the interactive REPL with slash commands and session context.",
    category: "runtime"
  },
  {
    name: "summary",
    description: "Render a concise project/runtime summary.",
    category: "introspection"
  },
  {
    name: "manifest",
    description: "Render the command and tool manifest.",
    category: "introspection"
  },
  {
    name: "commands",
    description: "List local CLI commands.",
    category: "introspection"
  },
  {
    name: "tools",
    description: "List registered tools.",
    category: "introspection"
  },
  {
    name: "route",
    description: "Route a prompt across the command and tool catalog.",
    category: "runtime"
  },
  {
    name: "bootstrap",
    description: "Create a runtime bootstrap report for a prompt.",
    category: "runtime"
  },
  {
    name: "turn-loop",
    aliases: ["turn"],
    description: "Run a bounded prompt turn loop with routing and optional tools.",
    category: "runtime"
  },
  {
    name: "prompt",
    aliases: ["ask"],
    description: "Run one prompt through the runtime.",
    category: "runtime"
  },
  {
    name: "exec-tool",
    description: "Execute one tool with an explicit JSON payload.",
    category: "local"
  },
  {
    name: "session",
    description: "List or load persisted sessions.",
    category: "session"
  },
  {
    name: "mcp-server",
    aliases: ["mcp"],
    description: "Start a Model Context Protocol stdio server exposing code-agent tools.",
    category: "runtime"
  },
  {
    name: "doctor",
    description: "Run local environment and configuration diagnostics.",
    category: "introspection"
  }
];

export function findCommand(name: string): CommandSpec | undefined {
  const needle = name.toLowerCase();
  return commandCatalog.find((command) => {
    return command.name === needle || command.aliases?.includes(needle);
  });
}
