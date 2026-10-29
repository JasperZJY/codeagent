import { visualLength } from "./markdownRenderer.js";
import type { PermissionMode, RuntimeConfig } from "../core/types.js";

export interface SlashMenuItem {
  id: string;
  label: string;
  command?: string;
  description?: string;
  children?: SlashMenuItem[];
  keywords?: string[];
}

export interface SlashMenuState {
  path: string[];
  selectedIndex: number;
  filter: string;
}

export interface SlashMenuSelection {
  state: SlashMenuState;
  input: string;
  submitted?: boolean;
}

const permissionModeItems: Array<{ mode: PermissionMode; description: string }> = [
  { mode: "read-only", description: "Read/list/search only" },
  { mode: "workspace-write", description: "Allow workspace file edits" },
  { mode: "danger-full-access", description: "Allow shell and dangerous tools" }
];

const resumeMenuItems: SlashMenuItem[] = [
  {
    id: "latest",
    label: "latest",
    description: "Resume most recent session",
    command: "/resume latest",
    keywords: ["last", "recent"]
  },
  {
    id: "list",
    label: "list",
    description: "List resumable sessions",
    command: "/resume",
    keywords: ["sessions", "ls"]
  },
  {
    id: "number",
    label: "number",
    description: "Resume by list number",
    command: "/resume ",
    keywords: ["index", "1", "2", "selector"]
  },
  {
    id: "title",
    label: "title / keyword",
    description: "Resume by title, summary, or last prompt",
    command: "/resume ",
    keywords: ["name", "search", "keyword"]
  },
  {
    id: "session-id",
    label: "session id",
    description: "Resume by session id or id prefix",
    command: "/resume ",
    keywords: ["id", "prefix"]
  },
  {
    id: "task",
    label: "task plan",
    description: "Resume latest incomplete task plan",
    command: "/resume-task",
    keywords: ["resume-task", "plan", "todo"]
  },
  {
    id: "allow-workspace",
    label: "allow workspace",
    description: "Allow switching to another workspace session",
    command: "/resume ",
    keywords: ["workspace", "cross-workspace"]
  }
];

export const slashMenuRoot: SlashMenuItem[] = [
  { id: "status", label: "status", description: "Show runtime status", command: "/status" },
  { id: "session", label: "session", description: "Show active session", command: "/session" },
  { id: "sessions", label: "sessions", description: "List saved sessions", command: "/sessions" },
  {
    id: "resume",
    label: "resume",
    description: "Switch saved session",
    command: "/resume ",
    children: resumeMenuItems,
    keywords: ["re", "session restore", "恢复会话"]
  },
  {
    id: "permissions",
    label: "permissions",
    description: "Switch permission mode",
    command: "/permissions ",
    children: permissionMenuItemsForConfig(),
    keywords: ["permission", "perm", "per", "权限"]
  },
  { id: "context", label: "context", description: "Show context health", command: "/context" },
  { id: "tokens", label: "tokens", description: "Show token usage", command: "/tokens" },
  { id: "cost", label: "cost", description: "Show cost status", command: "/cost" },
  {
    id: "model",
    label: "model",
    description: "Switch model/profile",
    children: [
      { id: "manual", label: "manual", description: "Type a model name", command: "/model " }
    ]
  },
  {
    id: "profile",
    label: "profile",
    description: "Switch provider profile",
    children: [
      { id: "list", label: "list", description: "List profiles", command: "/profile list" },
      { id: "current", label: "current", description: "Show current profile", command: "/profile current" }
    ]
  },
  {
    id: "git",
    label: "git",
    description: "Inspect changes",
    children: [
      { id: "status", label: "status", description: "Show changed files", command: "/changes" },
      { id: "diff", label: "diff", description: "Show git diff", command: "/diff " },
      { id: "changes", label: "changes", description: "Show agent changes", command: "/changes" },
      { id: "checkpoint", label: "checkpoint", description: "Create checkpoint", command: "/checkpoint" },
      { id: "revert", label: "revert", description: "Revert agent changes", command: "/revert" },
      { id: "commit-msg", label: "commit message", description: "Draft commit message", command: "/commit-msg" }
    ]
  },
  {
    id: "python",
    label: "python",
    description: "Run Python tools",
    children: [
      { id: "run", label: "run file", description: "Run a .py file", command: "/python run " },
      { id: "exec", label: "exec code", description: "Execute snippet", command: "/python exec " },
      { id: "last", label: "last result", description: "Show last result", command: "/python last" },
      { id: "clean", label: "clean", description: "Clean temp scripts", command: "/python clean" },
      { id: "settings", label: "settings", description: "Show Python safety defaults", command: "/python" }
    ]
  },
  { id: "memory", label: "memory", description: "Persistent memory", command: "/memory " },
  {
    id: "rag",
    label: "rag",
    description: "Workspace retrieval",
    children: [
      { id: "index", label: "index", description: "Build RAG index", command: "/rag index " },
      { id: "search", label: "search", description: "Search RAG", command: "/rag search " }
    ]
  },
  {
    id: "tasks",
    label: "tasks",
    description: "Manage task plan",
    children: [
      { id: "plan", label: "plan", description: "Show plan", command: "/plan" },
      { id: "todo", label: "todo", description: "Show todos", command: "/todo" },
      { id: "add", label: "add", description: "Add task", command: "/task add " },
      { id: "done", label: "done", description: "Mark done", command: "/task done " },
      { id: "block", label: "block", description: "Mark blocked", command: "/task block " },
      { id: "reset", label: "reset", description: "Reset plan", command: "/task reset" },
      { id: "resume", label: "resume", description: "Resume task", command: "/resume-task" }
    ]
  },
  {
    id: "skills",
    label: "skills",
    description: "Manage skills",
    children: [
      { id: "list", label: "list", description: "List skills", command: "/skills list" },
      { id: "search", label: "search", description: "Search skill", command: "/skills search " },
      { id: "use", label: "use", description: "Use skill", command: "/skills use " },
      { id: "read", label: "read", description: "Read skill", command: "/skills read " },
      { id: "create", label: "create", description: "Create skill", command: "/skills create " },
      { id: "reload", label: "reload", description: "Reload skills", command: "/skills reload" },
      { id: "init", label: "init", description: "Install built-ins", command: "/skills init" }
    ]
  },
  {
    id: "settings",
    label: "settings",
    description: "Runtime settings",
    children: [
      { id: "model", label: "model", description: "Switch model", command: "/model " },
      { id: "profile", label: "profile", description: "Switch profile", command: "/profile " },
      { id: "verbose", label: "verbose", description: "Toggle verbose", command: "/verbose " },
      { id: "markdown", label: "markdown", description: "Toggle Markdown", command: "/markdown " },
      { id: "dialog", label: "dialog blocks", description: "Toggle You/Agent blocks", command: "/dialog-blocks " },
      { id: "thinking", label: "thinking", description: "Show reasoning status", command: "/thinking " },
      { id: "timeout", label: "timeout", description: "Set LLM idle timeout", command: "/timeout " },
      { id: "tokens", label: "tokens", description: "Toggle token line", command: "/tokens show " },
      { id: "summary", label: "summary", description: "Set summary mode", command: "/summary " },
      { id: "terminal", label: "terminal mode", description: "TUI or scrollback", command: "/terminal-mode " },
      { id: "permissions", label: "permissions", description: "Switch permissions", command: "/permissions ", children: permissionMenuItemsForConfig() }
    ]
  },
  {
    id: "copy",
    label: "copy",
    description: "Copy conversation text",
    children: [
      { id: "last", label: "last", description: "Copy latest answer", command: "/copy last" },
      { id: "turn", label: "turn", description: "Copy latest turn", command: "/copy turn" },
      { id: "all", label: "all", description: "Copy visible history", command: "/copy all" },
      { id: "transcript", label: "transcript", description: "Copy full transcript", command: "/copy transcript" },
      { id: "save", label: "save", description: "Save copy text", command: "/copy save" }
    ]
  },
  { id: "help", label: "help", description: "Show help", command: "/help" }
];

export function createSlashMenuState(): SlashMenuState {
  return { path: [], selectedIndex: 0, filter: "" };
}

export function slashMenuIsActive(input: string): boolean {
  return input.trimStart().startsWith("/");
}

export function getSlashMenuItems(state: SlashMenuState): SlashMenuItem[] {
  return getSlashMenuItemsForConfig(state);
}

export function getSlashMenuItemsForConfig(state: SlashMenuState, config?: RuntimeConfig): SlashMenuItem[] {
  const root = slashMenuRootForConfig(config);
  const parent = findMenuItem(state.path, root);
  return parent?.children ?? root;
}

export function filteredSlashMenuItems(state: SlashMenuState, config?: RuntimeConfig): SlashMenuItem[] {
  const items = getSlashMenuItemsForConfig(state, config);
  const query = state.filter.trim().toLowerCase();
  if (!query) {
    return items;
  }
  return items
    .map((item, index) => ({ item, index, score: scoreMenuItem(item, query) }))
    .filter((entry) => entry.score > 0)
    .sort((left, right) => right.score - left.score || left.index - right.index)
    .map((entry) => entry.item);
}

export function moveSlashMenuSelection(state: SlashMenuState, delta: number, config?: RuntimeConfig): SlashMenuState {
  const items = filteredSlashMenuItems(state, config);
  if (items.length === 0) {
    return { ...state, selectedIndex: 0 };
  }
  return {
    ...state,
    selectedIndex: (state.selectedIndex + delta + items.length) % items.length
  };
}

export function enterSlashMenuSelection(state: SlashMenuState, config?: RuntimeConfig): SlashMenuSelection {
  const items = filteredSlashMenuItems(state, config);
  const item = items[state.selectedIndex] ?? items[0];
  if (!item) {
    return { state, input: "/" };
  }
  if (item.children?.length) {
    return {
      state: { path: [...state.path, item.id], selectedIndex: 0, filter: "" },
      input: item.command ?? `/${[...state.path, item.id].join(" ")} `
    };
  }
  return {
    state,
    input: item.command ?? `/${item.id}`,
    submitted: Boolean(item.command && !item.command.endsWith(" "))
  };
}

export function backSlashMenu(state: SlashMenuState): SlashMenuState {
  if (state.path.length === 0) {
    return createSlashMenuState();
  }
  return { path: state.path.slice(0, -1), selectedIndex: 0, filter: "" };
}

export function completeSlashMenuSelection(state: SlashMenuState): string {
  return enterSlashMenuSelection(state).input;
}

export function completeSlashMenuSelectionForConfig(state: SlashMenuState, config?: RuntimeConfig): string {
  return enterSlashMenuSelection(state, config).input;
}

export function slashMenuInputPrefix(state: SlashMenuState): string {
  return commandPrefixForPath(state) ?? (state.path.length ? `/${state.path.join(" ")} ` : "/");
}

export function updateSlashMenuFilterFromInput(input: string, state: SlashMenuState): SlashMenuState {
  const body = input.trimStart().slice(1);
  const parts = body.split(/\s+/).filter(Boolean);
  const withFilter = (filter: string): SlashMenuState => ({
    ...state,
    filter,
    selectedIndex: filter === state.filter ? state.selectedIndex : 0
  });
  if (state.path.length > 0) {
    const pathPrefix = state.path.join(" ");
    const commandPrefix = commandPrefixForPath(state)?.replace(/^\//, "").trim();
    const prefix = commandPrefix && body.startsWith(commandPrefix) ? commandPrefix : pathPrefix;
    const rest = body.startsWith(prefix) ? body.slice(prefix.length).trim() : "";
    return withFilter(rest);
  }
  if (parts.length === 0) {
    return withFilter("");
  }
  return withFilter(parts[0] ?? "");
}

export function renderSlashMenu(state: SlashMenuState, columns: number, config?: RuntimeConfig): string {
  const items = filteredSlashMenuItems(state, config);
  if (items.length === 0) {
    return "";
  }
  const title = state.path.length ? `/${state.path.join(" ")}` : "Commands";
  const width = Math.max(32, Math.min(columns - 2, 72));
  const innerWidth = width - 4;
  const labelWidth = Math.min(18, Math.max(...items.map((item) => item.label.length)));
  const rows = items.slice(0, 10).map((item, index) => {
    const marker = index === state.selectedIndex ? ">" : " ";
    const text = `${marker} ${item.label.padEnd(labelWidth)} ${item.description ?? ""}`;
    return `| ${padRight(fitTail(text, innerWidth), innerWidth)} |`;
  });
  const headerText = ` ${title} `;
  const headerFill = "-".repeat(Math.max(0, width - visualLength(headerText) - 2));
  return [
    `+${headerText}${headerFill}+`,
    ...rows,
    `+${"-".repeat(width - 2)}+`
  ].join("\n");
}

function slashMenuRootForConfig(config?: RuntimeConfig): SlashMenuItem[] {
  if (!config) {
    return slashMenuRoot;
  }
  const profiles = config.availableProfiles ?? [];
  const profileItems = profiles.map((name) => ({
    id: `profile-${name}`,
    label: name,
    description: name === config.profile ? "Current profile" : "Switch to profile",
    command: `/profile ${name}`
  }));
  const modelItems = [
    ...(config.model ? [{
      id: "current",
      label: config.model,
      description: "Current model",
      command: `/model ${config.model}`
    }] : []),
    ...profileItems,
    { id: "manual", label: "manual", description: "Type a model name", command: "/model " }
  ];
  const permissionItems = permissionMenuItemsForConfig(config);
  return slashMenuRoot.map((item) => {
    if (item.id === "model") {
      return { ...item, children: uniqueMenuItems(modelItems) };
    }
    if (item.id === "profile") {
      return { ...item, children: uniqueMenuItems([...profileItems, ...(item.children ?? [])]) };
    }
    if (item.id === "permissions") {
      return { ...item, children: permissionItems };
    }
    if (item.id === "settings") {
      return {
        ...item,
        children: (item.children ?? []).map((child) =>
          child.id === "permissions" ? { ...child, children: permissionItems } : child
        )
      };
    }
    return item;
  });
}

function permissionMenuItemsForConfig(config?: RuntimeConfig): SlashMenuItem[] {
  const currentMode = config?.permissionMode;
  if (!currentMode) {
    return [
      { id: "current", label: "current", description: "Show current mode", command: "/permissions" },
      ...permissionModeItems.map((item) => permissionModeMenuItem(item.mode, item.description))
    ];
  }

  return [
    {
      id: "current",
      label: currentMode,
      description: "Current permission mode",
      command: `/permissions ${currentMode}`
    },
    ...permissionModeItems
      .filter((item) => item.mode !== currentMode)
      .map((item) => permissionModeMenuItem(item.mode, item.description))
  ];
}

function permissionModeMenuItem(mode: PermissionMode, description: string): SlashMenuItem {
  return {
    id: mode,
    label: mode,
    description,
    command: `/permissions ${mode}`
  };
}

function uniqueMenuItems(items: SlashMenuItem[]): SlashMenuItem[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    const key = `${item.label}:${item.command ?? item.id}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

function scoreMenuItem(item: SlashMenuItem, query: string): number {
  const labels = [item.id, item.label, item.command?.replace(/^\//, "").split(/\s+/, 1)[0] ?? ""]
    .filter(Boolean)
    .map((value) => value.toLowerCase());
  if (labels.some((value) => value === query)) {
    return 100;
  }
  if (labels.some((value) => value.startsWith(query))) {
    return 80;
  }
  if ((item.keywords ?? []).some((value) => value.toLowerCase().startsWith(query))) {
    return 70;
  }
  if (labels.some((value) => value.includes(query))) {
    return 50;
  }
  if ((item.keywords ?? []).some((value) => value.toLowerCase().includes(query))) {
    return 40;
  }
  const description = item.description?.toLowerCase() ?? "";
  if (query.length >= 2 && description.includes(query)) {
    return 10;
  }
  return 0;
}

function findMenuItem(pathIds: string[], root: SlashMenuItem[] = slashMenuRoot): SlashMenuItem | undefined {
  let items = root;
  let current: SlashMenuItem | undefined;
  for (const id of pathIds) {
    current = items.find((item) => item.id === id);
    if (!current) {
      return undefined;
    }
    items = current.children ?? [];
  }
  return current;
}

function commandPrefixForPath(state: SlashMenuState): string | undefined {
  return findMenuItem(state.path)?.command;
}

function fitTail(value: string, width: number): string {
  if (visualLength(value) <= width) {
    return value;
  }
  let output = "";
  for (const char of [...value].reverse()) {
    if (visualLength(`...${char}${output}`) > width) {
      break;
    }
    output = `${char}${output}`;
  }
  return `...${output}`;
}

function padRight(value: string, width: number): string {
  const length = visualLength(value);
  return length >= width ? value : `${value}${" ".repeat(width - length)}`;
}
