export type OutputFormat = "text" | "json" | "markdown";

export type PermissionMode = "read-only" | "workspace-write" | "danger-full-access";

export type ProviderKind = "openai-compatible" | "anthropic";

export type ContextCompressionMode = "off" | "local" | "headroom";
export type SummaryMode = "auto" | "off" | "always";
export type TerminalMode = "tui" | "scrollback";
export type ThinkingDisplayMode = "off" | "summary" | "verbose";

export type MessageRole = "system" | "user" | "assistant" | "tool";

export type StopReason =
  | "completed"
  | "tool_use"
  | "max_turns_reached"
  | "max_budget_reached"
  | "error";

export interface TextBlock {
  type: "text";
  text: string;
}

export interface ToolUseBlock {
  type: "tool_use";
  id: string;
  name: string;
  input: unknown;
}

export interface ToolResultBlock {
  type: "tool_result";
  toolUseId: string;
  toolName: string;
  output: unknown;
  isError: boolean;
}

export type ContentBlock = TextBlock | ToolUseBlock | ToolResultBlock;

export interface ConversationMessage {
  role: MessageRole;
  blocks: ContentBlock[];
  usage?: TokenUsage;
}

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  estimated?: boolean;
  source?: "api" | "estimated";
}

export interface ThinkingTrace {
  source: "reasoning_content" | "reasoning" | "thinking" | "think_tag";
  chars: number;
}

export type GoalStatus = "pending" | "running" | "done" | "blocked";

export interface AgentGoal {
  id: string;
  title: string;
  status: GoalStatus;
  evidence?: string;
  updatedAt: string;
}

export type TaskStatus = "pending" | "running" | "done" | "blocked" | "failed";

export interface AgentTask {
  id: string;
  title: string;
  status: TaskStatus;
  reason: string;
  evidence: string;
  updatedAt: string;
}

export interface AgentTaskPlan {
  id: string;
  sessionId?: string;
  prompt: string;
  status: TaskStatus;
  tasks: AgentTask[];
  createdAt: string;
  updatedAt: string;
}

export interface ProjectDetection {
  type: "node" | "python" | "make" | "rust" | "maven";
  file: string;
  details?: Record<string, unknown>;
}

export interface ProjectCommandProfile {
  workspaceRoot: string;
  detections: ProjectDetection[];
  commands: Partial<Record<"typecheck" | "test" | "lint" | "build" | "dev", string>>;
  warnings: string[];
  updatedAt: string;
}

export interface ParsedError {
  file?: string;
  line?: number;
  column?: number;
  type: string;
  message: string;
  raw: string;
}

export interface ValidationCommandResult {
  command: string;
  ok: boolean;
  attempt: number;
  durationMs: number;
  errors: ParsedError[];
  outputPreview: string;
}

export interface TestFixLoopResult {
  status: "passed" | "failed" | "blocked" | "warning";
  attempts: number;
  fixAttempts: number;
  commands: ValidationCommandResult[];
  errors: ParsedError[];
  message: string;
  needsUserIntervention: boolean;
}

export type CodeSymbolKind =
  | "function"
  | "class"
  | "method"
  | "variable"
  | "export"
  | "import";

export interface CodeSymbol {
  name: string;
  kind: CodeSymbolKind;
  file: string;
  line: number;
  column: number;
  exported: boolean;
  container?: string;
  signature?: string;
}

export interface CodeImportExport {
  file: string;
  line: number;
  kind: "import" | "export";
  source?: string;
  names: string[];
  raw: string;
}

export interface CodeReference {
  name: string;
  file: string;
  line: number;
  column: number;
  text: string;
}

export interface CallGraphEdge {
  caller: string;
  callee: string;
  file: string;
  line: number;
}

export interface CodeOutline {
  file: string;
  symbols: CodeSymbol[];
  imports: CodeImportExport[];
}

export interface SymbolIndex {
  version: 1;
  workspaceRoot: string;
  createdAt: string;
  files: string[];
  symbols: CodeSymbol[];
  imports: CodeImportExport[];
  callGraph: CallGraphEdge[];
  skippedDirectories: string[];
}

export interface ProjectInitResult {
  projectPath: string;
  rulesPath: string;
  commandsPath: string;
  profile: ProjectCommandProfile;
  outlineFiles: number;
  risks: string[];
}

export interface ContextMonitorReport {
  sessionId: string;
  messages: number;
  promptHistory: number;
  usage: TokenUsage;
  estimatedActiveTokens: number;
  toolResultTokens: number;
  toolResultRatio: number;
  compressionMode: ContextCompressionMode;
  compactionDetected: boolean;
  ccrEntries: number;
  cost: {
    provider: ProviderKind;
    model: string;
    local: boolean;
    estimatedUsd?: number;
    note: string;
  };
}

export interface ResumeState {
  sessionId?: string;
  lastPrompt?: string;
  goals: AgentGoal[];
  taskPlan?: AgentTaskPlan;
  changedFiles: Array<{ path: string; status: string; toolName: string }>;
  executedCommands: string[];
  validationStatus: "passed" | "failed" | "blocked" | "warning" | "unknown";
  blockedReasons: string[];
  nextSteps: string[];
}

export interface CommandSpec {
  name: string;
  aliases?: string[];
  description: string;
  category: "local" | "runtime" | "session" | "introspection";
}

export interface ToolSpec {
  name: string;
  description: string;
  requiredPermission: PermissionMode;
  inputSchema: Record<string, unknown>;
  routeHints: string[];
}

export interface RoutedMatch {
  kind: "command" | "tool";
  name: string;
  score: number;
  description: string;
}

export interface PermissionRequest {
  toolName: string;
  input: unknown;
  activeMode: PermissionMode;
  requiredMode: PermissionMode;
}

export interface PermissionDecision {
  allowed: boolean;
  reason: string;
}

export interface ToolExecution {
  toolName: string;
  input: unknown;
  ok: boolean;
  output: unknown;
  durationMs: number;
}

export type RuntimeTraceEvent =
  | {
      type: "running";
      label: string;
      detail?: string;
      input?: unknown;
    }
  | {
      type: "ran";
      label: string;
      detail?: string;
      ok?: boolean;
      durationMs?: number;
      input?: unknown;
      output?: unknown;
    }
  | {
      type: "info";
      label: string;
      detail?: string;
      output?: unknown;
    };

export interface TurnSummary {
  sessionId: string;
  assistantMessages: ConversationMessage[];
  toolResults: ConversationMessage[];
  routedMatches: RoutedMatch[];
  iterations: number;
  usage: TokenUsage;
  turnUsage?: TokenUsage;
  stopReason: StopReason;
  trace?: RuntimeTraceEvent[];
  taskPlan?: AgentTaskPlan;
  validation?: TestFixLoopResult;
  contextReport?: ContextMonitorReport;
  semanticEvidence?: string[];
  reflectionDecision?: {
    shouldReflect: boolean;
    reason: string;
    level: "none" | "light" | "full";
  };
  loadedSkills?: Array<{
    name: string;
    description: string;
    source: "workspace" | "builtin";
    path: string;
  }>;
  summary?: {
    shown: boolean;
    reason: string;
    style: "none" | "brief" | "full";
  };
}

export interface RuntimeConfig {
  workspaceRoot: string;
  profile?: string;
  availableProfiles?: string[];
  provider: ProviderKind;
  model: string;
  baseUrl: string;
  apiKey: string;
  permissionMode: PermissionMode;
  outputFormat: OutputFormat;
  maxTurns: number;
  maxBudgetTokens: number;
  llmTimeoutMs?: number;
  sessionId?: string;
  useLlm: boolean;
  verbose?: boolean;
  markdown?: boolean;
  dialogBlocks?: boolean;
  showTokenUsage?: boolean;
  summaryMode?: SummaryMode;
  terminalMode?: TerminalMode;
  thinkingDisplay?: ThinkingDisplayMode;
  contextCompression?: ContextCompressionMode;
  headroomBaseUrl?: string;
}

export type CliAction =
  | { type: "interactive" }
  | { type: "help" }
  | { type: "summary" }
  | { type: "manifest" }
  | { type: "commands"; query?: string; limit: number }
  | { type: "tools"; query?: string; limit: number }
  | { type: "route"; prompt: string; limit: number }
  | { type: "bootstrap"; prompt: string; limit: number }
  | { type: "turn-loop"; prompt: string; limit: number }
  | { type: "prompt"; prompt: string; limit: number }
  | { type: "exec-tool"; name: string; payload: string }
  | { type: "session-list" }
  | { type: "session-load"; sessionId: string }
  | { type: "mcp-server" }
  | { type: "doctor" };
