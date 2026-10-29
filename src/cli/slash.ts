export type SlashCommandName =
  | "help"
  | "status"
  | "model"
  | "profile"
  | "provider"
  | "permissions"
  | "session"
  | "sessions"
  | "resume"
  | "compact"
  | "goals"
  | "memory"
  | "rag"
  | "python"
  | "skills"
  | "verbose"
  | "markdown"
  | "dialog-blocks"
  | "thinking"
  | "timeout"
  | "summary"
  | "terminal-mode"
  | "copy"
  | "transcript"
  | "diff"
  | "changes"
  | "checkpoint"
  | "revert"
  | "commit-msg"
  | "risk"
  | "plan"
  | "todo"
  | "task"
  | "resume-task"
  | "init"
  | "context"
  | "tokens"
  | "cost"
  | "clear"
  | "exit";

export type SlashCommandType = SlashCommandName | "unknown";

export interface ParsedSlashCommand {
  name: SlashCommandType;
  rawName: string;
  args: string[];
  rawArgs: string;
}

export interface SlashCommandHelpEntry {
  usage: string;
  description: string;
}

export const slashCommandHelp: SlashCommandHelpEntry[] = [
  { usage: "/help", description: "Show interactive command help." },
  { usage: "/status", description: "Show provider, model, permissions, workspace, and session state." },
  { usage: "/model [name]", description: "Show or switch the active model." },
  { usage: "/profile [list|current|name]", description: "List or switch configured provider/model profiles." },
  { usage: "/provider [name]", description: "Show or switch provider: openai-compatible or anthropic." },
  { usage: "/permissions [mode]", description: "Show or switch permission mode." },
  { usage: "/session [rename|summarize|id|refresh-title]", description: "Show or update the active session metadata." },
  { usage: "/sessions [all|current-workspace|search]", description: "List saved sessions by title and summary." },
  { usage: "/resume [selector]", description: "Switch to a saved session by number, title, or id." },
  { usage: "/compact [keep]", description: "Compress context and keep the latest N messages." },
  { usage: "/compress [keep]", description: "Alias for /compact." },
  { usage: "/goals", description: "Show active turn goals and monitoring status." },
  { usage: "/memory [query]", description: "List or search persistent project memory." },
  { usage: "/rag index [path]", description: "Build the local workspace RAG index." },
  { usage: "/rag search <query>", description: "Search the local workspace RAG index." },
  { usage: "/python [run|exec|last|clean]", description: "Run Python snippets or workspace .py files." },
  { usage: "/skills [list|search|use|read|create|reload|init]", description: "Manage reusable skill workflows." },
  { usage: "/verbose on|off", description: "Toggle detailed internal trace output." },
  { usage: "/markdown on|off", description: "Toggle terminal Markdown rendering." },
  { usage: "/dialog-blocks on|off", description: "Toggle You/Agent dialog blocks." },
  { usage: "/thinking off|summary|verbose", description: "Control provider thinking display." },
  { usage: "/timeout [ms]", description: "Show or set the LLM request/stream idle timeout in milliseconds." },
  { usage: "/summary auto|off|always", description: "Control final summary verbosity." },
  { usage: "/terminal-mode tui|scrollback", description: "Switch between fixed TUI and native scrollback mode." },
  { usage: "/copy last|turn|all|transcript|save", description: "Copy or save conversation content without ANSI." },
  { usage: "/transcript [all|save]", description: "Show or save full uncompressed turn transcript." },
  { usage: "/diff [path]", description: "Show current git diff." },
  { usage: "/changes", description: "Show files changed by the latest agent checkpoint." },
  { usage: "/checkpoint", description: "Create a rollback checkpoint." },
  { usage: "/revert", description: "Revert files changed by the latest agent checkpoint." },
  { usage: "/commit-msg", description: "Generate a commit message draft from current git changes." },
  { usage: "/risk <command>", description: "Analyze shell command risk before running it." },
  { usage: "/plan", description: "Show the current persisted execution plan." },
  { usage: "/todo", description: "Show the current task list." },
  { usage: "/task add <content>", description: "Add a task to the current plan." },
  { usage: "/task done <id>", description: "Mark a task as done." },
  { usage: "/task block <id>", description: "Mark a task as blocked." },
  { usage: "/task reset", description: "Clear the current task plan." },
  { usage: "/resume-task", description: "Resume the latest incomplete task plan." },
  { usage: "/init", description: "Analyze the project and write .code-agent project files." },
  { usage: "/context", description: "Show context usage, tool-result ratio, compression, and CCR state." },
  { usage: "/tokens", description: "Show token usage estimates for the current session." },
  { usage: "/cost", description: "Show local/remote model cost estimate status." },
  { usage: "/clear", description: "Clear the terminal and redraw the banner." },
  { usage: "/exit", description: "Exit the interactive shell." }
];

const aliases: Record<string, SlashCommandName> = {
  h: "help",
  help: "help",
  status: "status",
  model: "model",
  profile: "profile",
  profiles: "profile",
  prof: "profile",
  provider: "provider",
  permission: "permissions",
  permissions: "permissions",
  perm: "permissions",
  session: "session",
  sessions: "sessions",
  resume: "resume",
  compact: "compact",
  compress: "compact",
  goals: "goals",
  goal: "goals",
  memory: "memory",
  mem: "memory",
  rag: "rag",
  python: "python",
  py: "python",
  skills: "skills",
  skill: "skills",
  verbose: "verbose",
  debug: "verbose",
  markdown: "markdown",
  md: "markdown",
  "dialog-blocks": "dialog-blocks",
  dialog: "dialog-blocks",
  thinking: "thinking",
  think: "thinking",
  timeout: "timeout",
  summary: "summary",
  "terminal-mode": "terminal-mode",
  terminal: "terminal-mode",
  copy: "copy",
  transcript: "transcript",
  t: "transcript",
  diff: "diff",
  changes: "changes",
  checkpoint: "checkpoint",
  revert: "revert",
  rollback: "revert",
  "commit-msg": "commit-msg",
  commitmsg: "commit-msg",
  risk: "risk",
  plan: "plan",
  todo: "todo",
  tasks: "todo",
  task: "task",
  "resume-task": "resume-task",
  resumetask: "resume-task",
  init: "init",
  context: "context",
  ctx: "context",
  tokens: "tokens",
  token: "tokens",
  cost: "cost",
  clear: "clear",
  exit: "exit",
  quit: "exit",
  q: "exit"
};

export function parseSlashCommand(input: string): ParsedSlashCommand | undefined {
  const trimmed = input.trim();
  if (!trimmed.startsWith("/")) {
    return undefined;
  }

  const body = trimmed.slice(1).trim();
  if (!body) {
    return { name: "unknown", rawName: "", args: [], rawArgs: "" };
  }

  const firstSpace = body.search(/\s/);
  const rawName = (firstSpace < 0 ? body : body.slice(0, firstSpace)).toLowerCase();
  const rawArgs = firstSpace < 0 ? "" : body.slice(firstSpace).trim();
  const args = rawArgs ? rawArgs.split(/\s+/) : [];
  return {
    name: aliases[rawName] ?? "unknown",
    rawName,
    args,
    rawArgs
  };
}

export function parseKeepMessages(command: ParsedSlashCommand, fallback = 6): number {
  if (!command.args[0]) {
    return fallback;
  }
  const parsed = Number(command.args[0]);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error("invalid_compact_keep: expected a non-negative integer");
  }
  return parsed;
}

export function suggestSlashCommands(input: string, limit = 8): SlashCommandHelpEntry[] {
  const trimmed = input.trimStart();
  if (!trimmed.startsWith("/")) {
    return [];
  }
  const body = trimmed.slice(1);
  if (/\s/.test(body)) {
    return [];
  }
  const prefix = body.toLowerCase();
  const scored = slashCommandHelp
    .map((entry, index) => {
      const command = entry.usage.split(/\s+/, 1)[0]?.slice(1).toLowerCase() ?? "";
      const score = command === prefix ? 100 : command.startsWith(prefix) ? 50 : command.includes(prefix) ? 10 : 0;
      return { entry, score, command, index };
    })
    .filter((item) => item.score > 0 || prefix === "")
    .sort((a, b) => b.score - a.score || a.index - b.index || a.command.localeCompare(b.command));
  return scored.slice(0, limit).map((item) => item.entry);
}
