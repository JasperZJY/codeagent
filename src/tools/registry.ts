import { performance } from "node:perf_hooks";
import { ChangeTracker, type MutationSnapshot } from "../core/changeTracker.js";
import { authorizeTool, type ToolAuthorizationContext } from "../core/permissions.js";
import { analyzeCommandRisk, isSensitivePath, redactSensitiveData, redactSensitiveText } from "../core/security.js";
import type { ToolExecution, ToolSpec } from "../core/types.js";
import { asObject } from "../utils/json.js";
import { ccrRetrieveTool } from "./contextTools.js";
import { memorySearchTool, memoryWriteTool } from "./memoryTools.js";
import { ragIndexTool, ragSearchTool } from "./ragTools.js";
import {
  editFileTool,
  globSearchTool,
  grepSearchTool,
  listDirTool,
  readFileTool,
  shellTool,
  writeFileTool
} from "./fileTools.js";
import {
  changesSummaryTool,
  checkpointCreateTool,
  gitCommitMessageTool,
  gitDiffTool,
  gitStatusTool,
  revertChangesTool,
  riskAnalyzeTool
} from "./gitTools.js";
import { fetchUrlTool, webSearchTool } from "./webTools.js";
import {
  taskAddTool,
  taskPlanTool,
  taskResetTool,
  taskResumeTool,
  taskUpdateTool
} from "./taskTools.js";
import { projectProfileTool } from "./projectTools.js";
import { parseErrorsTool, validationPlanTool } from "./testTools.js";
import {
  analyzeImportsTool,
  callGraphTool,
  codeOutlineTool,
  findDefinitionTool,
  findReferencesTool,
  symbolIndexTool,
  symbolSearchTool
} from "./codeIntelTools.js";
import { projectInitTool } from "./initTools.js";
import { contextMonitorTool, resumeStateTool } from "./contextMonitorTools.js";
import {
  pythonAnalyzeResultTool,
  pythonCleanTool,
  pythonExecTool,
  pythonLastResultTool,
  pythonRiskTool,
  pythonRunFileTool,
  pythonWriteAndRunTool
} from "./pythonTools.js";
import {
  skillCreateTool,
  skillInitTool,
  skillListTool,
  skillReadTool,
  skillReloadTool,
  skillSearchTool,
  skillUseTool
} from "./skillTools.js";

export const toolCatalog: ToolSpec[] = [
  {
    name: "read_file",
    description: "Read a UTF-8 text file inside the workspace.",
    requiredPermission: "read-only",
    routeHints: ["read", "open", "show", "inspect", "cat", "file", "读取", "阅读", "查看", "打开", "文件"],
    inputSchema: { type: "object", required: ["path"] }
  },
  {
    name: "write_file",
    description: "Create or replace a UTF-8 text file inside the workspace.",
    requiredPermission: "workspace-write",
    routeHints: ["write", "create", "save", "replace", "写入", "创建", "保存", "替换"],
    inputSchema: { type: "object", required: ["path", "content"] }
  },
  {
    name: "edit_file",
    description: "Replace text inside an existing workspace file.",
    requiredPermission: "workspace-write",
    routeHints: ["edit", "modify", "patch", "replace", "编辑", "修改", "补丁", "替换"],
    inputSchema: { type: "object", required: ["path", "oldString", "newString"] }
  },
  {
    name: "list_dir",
    description: "List files and directories inside a workspace directory.",
    requiredPermission: "read-only",
    routeHints: [
      "list",
      "dir",
      "ls",
      "tree",
      "files",
      "project structure",
      "repo structure",
      "列出",
      "目录",
      "目录结构",
      "项目目录",
      "项目结构",
      "工程结构",
      "项目架构",
      "文件列表",
      "本地文件",
      "工作区"
    ],
    inputSchema: { type: "object", required: [] }
  },
  {
    name: "glob_search",
    description: "Find files using a glob-like pattern.",
    requiredPermission: "read-only",
    routeHints: ["glob", "find", "files", "*.ts", "*.py", "查找文件", "匹配文件", "文件名"],
    inputSchema: { type: "object", required: ["pattern"] }
  },
  {
    name: "grep_search",
    description: "Search workspace text files with a regular expression.",
    requiredPermission: "read-only",
    routeHints: ["grep", "search", "rg", "regex", "find text", "搜索文本", "查找文本", "正则", "内容搜索"],
    inputSchema: { type: "object", required: ["pattern"] }
  },
  {
    name: "shell",
    description: "Run a shell command in the workspace.",
    requiredPermission: "danger-full-access",
    routeHints: ["shell", "bash", "powershell", "command", "run", "命令", "执行", "运行"],
    inputSchema: { type: "object", required: ["command"] }
  },
  {
    name: "python_exec",
    description: "Execute a short Python snippet in a controlled workspace temp script.",
    requiredPermission: "workspace-write",
    routeHints: ["python", "python exec", "snippet", "run python", "execute python", "script"],
    inputSchema: { type: "object", required: ["code"] }
  },
  {
    name: "python_run_file",
    description: "Run an existing .py file inside the workspace and return structured stdout/stderr.",
    requiredPermission: "workspace-write",
    routeHints: ["python run", "run .py", "run file", "python file", ".py"],
    inputSchema: { type: "object", required: ["path"] }
  },
  {
    name: "python_write_and_run",
    description: "Write a temporary Python script under .code-agent/tmp and run it.",
    requiredPermission: "workspace-write",
    routeHints: ["write python", "python script", "analyze with python", "statistics", "data analysis"],
    inputSchema: { type: "object", required: ["code"] }
  },
  {
    name: "python_analyze_result",
    description: "Analyze a Python execution result and extract an error summary.",
    requiredPermission: "read-only",
    routeHints: ["python error", "traceback", "syntaxerror", "analyze python result"],
    inputSchema: { type: "object", required: [] }
  },
  {
    name: "python_last_result",
    description: "Show the latest saved Python execution result.",
    requiredPermission: "read-only",
    routeHints: ["python last", "last python result"],
    inputSchema: { type: "object", required: [] }
  },
  {
    name: "python_clean_tmp",
    description: "Clean Python temporary scripts from .code-agent/tmp.",
    requiredPermission: "workspace-write",
    routeHints: ["python clean", "clean python temp"],
    inputSchema: { type: "object", required: [] }
  },
  {
    name: "python_risk",
    description: "Analyze Python code risk before execution.",
    requiredPermission: "read-only",
    routeHints: ["python risk", "python security"],
    inputSchema: { type: "object", required: ["code"] }
  },
  {
    name: "git_status",
    description: "Show current git workspace changed files.",
    requiredPermission: "read-only",
    routeHints: ["git", "status", "changes", "modified", "workspace changes"],
    inputSchema: { type: "object", required: [] }
  },
  {
    name: "git_diff",
    description: "Show current git diff for the workspace or a specific path.",
    requiredPermission: "read-only",
    routeHints: ["git diff", "diff", "patch", "change diff", "show patch"],
    inputSchema: { type: "object", required: [] }
  },
  {
    name: "changes_summary",
    description: "Show files changed by the latest agent checkpoint.",
    requiredPermission: "read-only",
    routeHints: ["agent changes", "summary changes", "latest changes", "change summary"],
    inputSchema: { type: "object", required: [] }
  },
  {
    name: "checkpoint_create",
    description: "Create a checkpoint for later same-turn rollback.",
    requiredPermission: "workspace-write",
    routeHints: ["checkpoint", "snapshot", "save point", "rollback point"],
    inputSchema: { type: "object", required: [] }
  },
  {
    name: "revert_changes",
    description: "Revert files written by the latest agent checkpoint without overwriting later user edits.",
    requiredPermission: "workspace-write",
    routeHints: ["revert", "rollback", "undo", "restore changes"],
    inputSchema: { type: "object", required: [] }
  },
  {
    name: "git_commit_message",
    description: "Generate a commit message draft from current git status.",
    requiredPermission: "read-only",
    routeHints: ["commit message", "commit-msg", "git commit", "commit draft"],
    inputSchema: { type: "object", required: [] }
  },
  {
    name: "risk_analyze",
    description: "Analyze a shell command risk classification before execution.",
    requiredPermission: "read-only",
    routeHints: ["risk", "security", "dangerous command", "command safety"],
    inputSchema: { type: "object", required: ["command"] }
  },
  {
    name: "task_plan",
    description: "Show the current persisted Plan/Todo task list.",
    requiredPermission: "read-only",
    routeHints: ["plan", "todo", "tasks", "任务", "计划", "待办"],
    inputSchema: { type: "object", required: [] }
  },
  {
    name: "task_add",
    description: "Add a task to the current Plan/Todo list.",
    requiredPermission: "workspace-write",
    routeHints: ["task add", "add task", "新增任务", "添加任务"],
    inputSchema: { type: "object", required: ["content"] }
  },
  {
    name: "task_update",
    description: "Update a task status in the current Plan/Todo list.",
    requiredPermission: "workspace-write",
    routeHints: ["task done", "task block", "mark task", "完成任务", "阻塞任务"],
    inputSchema: { type: "object", required: ["id", "status"] }
  },
  {
    name: "task_reset",
    description: "Clear the current persisted Plan/Todo list.",
    requiredPermission: "workspace-write",
    routeHints: ["task reset", "clear tasks", "清空任务", "重置任务"],
    inputSchema: { type: "object", required: [] }
  },
  {
    name: "task_resume",
    description: "Resume the latest incomplete Plan/Todo list.",
    requiredPermission: "read-only",
    routeHints: ["resume task", "恢复任务", "继续任务"],
    inputSchema: { type: "object", required: [] }
  },
  {
    name: "project_profile",
    description: "Detect project types and infer typecheck/test/lint/build/dev commands.",
    requiredPermission: "read-only",
    routeHints: ["project profile", "detect project", "commands", "项目命令", "项目类型"],
    inputSchema: { type: "object", required: [] }
  },
  {
    name: "validation_plan",
    description: "Infer non-interactive validation commands for the current workspace.",
    requiredPermission: "read-only",
    routeHints: ["validation", "verify", "test commands", "验证命令", "测试命令"],
    inputSchema: { type: "object", required: [] }
  },
  {
    name: "parse_errors",
    description: "Parse TypeScript, npm test, and Python error logs into structured errors.",
    requiredPermission: "read-only",
    routeHints: ["parse errors", "error log", "测试失败", "错误日志"],
    inputSchema: { type: "object", required: ["output"] }
  },
  {
    name: "symbol_index",
    description: "Build a cached code symbol index for TypeScript, JavaScript, and Python files.",
    requiredPermission: "read-only",
    routeHints: ["symbol index", "code index", "语义索引", "符号索引"],
    inputSchema: { type: "object", required: [] }
  },
  {
    name: "symbol_search",
    description: "Search indexed functions, classes, variables, imports, and exported symbols.",
    requiredPermission: "read-only",
    routeHints: ["symbol", "function", "class", "export", "符号", "函数", "类", "导出"],
    inputSchema: { type: "object", required: ["query"] }
  },
  {
    name: "find_definition",
    description: "Find code symbol definitions with file path and line number.",
    requiredPermission: "read-only",
    routeHints: ["definition", "go to definition", "find definition", "定义", "跳转定义"],
    inputSchema: { type: "object", required: ["name"] }
  },
  {
    name: "find_references",
    description: "Find text references for a symbol in indexed code files.",
    requiredPermission: "read-only",
    routeHints: ["references", "find references", "引用", "查找引用"],
    inputSchema: { type: "object", required: ["name"] }
  },
  {
    name: "analyze_imports",
    description: "Analyze import and export declarations.",
    requiredPermission: "read-only",
    routeHints: ["imports", "exports", "dependencies", "import/export", "导入", "导出"],
    inputSchema: { type: "object", required: [] }
  },
  {
    name: "call_graph",
    description: "Generate a simple call graph from indexed code.",
    requiredPermission: "read-only",
    routeHints: ["call graph", "calls", "调用关系", "调用图"],
    inputSchema: { type: "object", required: [] }
  },
  {
    name: "code_outline",
    description: "Show file-level code outline from the symbol index.",
    requiredPermission: "read-only",
    routeHints: ["outline", "code outline", "符号大纲", "代码大纲"],
    inputSchema: { type: "object", required: [] }
  },
  {
    name: "project_init",
    description: "Initialize project intelligence files under .code-agent/project.md, rules.md, and commands.md.",
    requiredPermission: "workspace-write",
    routeHints: ["init", "project init", "初始化", "项目初始化"],
    inputSchema: { type: "object", required: [] }
  },
  {
    name: "context_monitor",
    description: "Report context, token, CCR, compression, and cost estimates.",
    requiredPermission: "read-only",
    routeHints: ["context", "tokens", "cost", "上下文", "token", "成本"],
    inputSchema: { type: "object", required: [] }
  },
  {
    name: "resume_state",
    description: "Build a long-term resume state including goals, plan, changes, commands, and blockers.",
    requiredPermission: "read-only",
    routeHints: ["resume state", "恢复状态", "长期恢复"],
    inputSchema: { type: "object", required: [] }
  },
  {
    name: "structured_output",
    description: "Normalize arbitrary input into a structured JSON response.",
    requiredPermission: "read-only",
    routeHints: ["json", "structured", "format"],
    inputSchema: { type: "object", required: [] }
  },
  {
    name: "fetch_url",
    description: "Fetch text content from a specific HTTP or HTTPS URL.",
    requiredPermission: "read-only",
    routeHints: ["url", "http", "https", "fetch", "网页", "网址", "链接", "抓取"],
    inputSchema: { type: "object", required: ["url"] }
  },
  {
    name: "web_search",
    description: "Search the internet through a configured search provider.",
    requiredPermission: "read-only",
    routeHints: ["web", "internet", "search", "latest", "current", "联网", "上网", "搜索网页", "最新"],
    inputSchema: { type: "object", required: ["query"] }
  },
  {
    name: "ccr_retrieve",
    description: "Retrieve original content from the local CCR compression cache.",
    requiredPermission: "read-only",
    routeHints: ["ccr", "retrieve", "compressed", "取回", "恢复", "压缩上下文"],
    inputSchema: { type: "object", required: ["ref"] }
  },
  {
    name: "memory_search",
    description: "Search persistent project memory and learned lessons.",
    requiredPermission: "read-only",
    routeHints: ["memory", "remember", "lesson", "偏好", "记忆", "经验", "学习"],
    inputSchema: { type: "object", required: ["query"] }
  },
  {
    name: "memory_write",
    description: "Write a durable project memory entry.",
    requiredPermission: "workspace-write",
    routeHints: ["remember", "learn", "memory", "记住", "学习", "经验"],
    inputSchema: { type: "object", required: ["text"] }
  },
  {
    name: "rag_index",
    description: "Build a local keyword RAG index for workspace text files.",
    requiredPermission: "workspace-write",
    routeHints: ["rag", "index", "索引", "知识库", "检索"],
    inputSchema: { type: "object", required: [] }
  },
  {
    name: "rag_search",
    description: "Search the local workspace RAG index for relevant snippets.",
    requiredPermission: "read-only",
    routeHints: ["rag", "search", "retrieve", "知识库", "检索"],
    inputSchema: { type: "object", required: ["query"] }
  },
  {
    name: "skill_list",
    description: "List built-in and workspace skills.",
    requiredPermission: "read-only",
    routeHints: ["skills", "skill list", "abilities", "workflow"],
    inputSchema: { type: "object", required: [] }
  },
  {
    name: "skill_search",
    description: "Search reusable skills by name, trigger, and description.",
    requiredPermission: "read-only",
    routeHints: ["skill search", "find skill", "workflow search"],
    inputSchema: { type: "object", required: ["query"] }
  },
  {
    name: "skill_read",
    description: "Read a skill's SKILL.md workflow.",
    requiredPermission: "read-only",
    routeHints: ["skill read", "show skill", "skill detail"],
    inputSchema: { type: "object", required: ["name"] }
  },
  {
    name: "skill_use",
    description: "Load a skill workflow for the current task.",
    requiredPermission: "read-only",
    routeHints: ["skill use", "use skill", "load skill"],
    inputSchema: { type: "object", required: ["name"] }
  },
  {
    name: "skill_create",
    description: "Create a workspace skill template under .code-agent/skills.",
    requiredPermission: "workspace-write",
    routeHints: ["skill create", "new skill"],
    inputSchema: { type: "object", required: ["name"] }
  },
  {
    name: "skill_reload",
    description: "Reload available skills from disk.",
    requiredPermission: "read-only",
    routeHints: ["skill reload", "reload skills"],
    inputSchema: { type: "object", required: [] }
  },
  {
    name: "skill_init",
    description: "Copy built-in skill templates into .code-agent/skills.",
    requiredPermission: "workspace-write",
    routeHints: ["skills init", "init skills", "install skills"],
    inputSchema: { type: "object", required: [] }
  }
];

export function findTool(name: string): ToolSpec | undefined {
  const needle = name.toLowerCase();
  return toolCatalog.find((tool) => tool.name === needle);
}

export async function executeTool(
  name: string,
  input: unknown,
  context: ToolAuthorizationContext
): Promise<ToolExecution> {
  const spec = findTool(name);
  if (!spec) {
    return {
      toolName: name,
      input,
      ok: false,
      output: `Unknown tool: ${name}`,
      durationMs: 0
    };
  }

  const started = performance.now();
  const safeInput = redactSensitiveData(input);
  const permission = authorizeTool(spec, input, context);
  if (!permission.allowed) {
    return {
      toolName: spec.name,
      input: safeInput,
      ok: false,
      output: redactSensitiveText(permission.reason),
      durationMs: Math.round(performance.now() - started)
    };
  }

  try {
    const objectInput = asObject(input);
    const riskBlocked = maybeBlockByRisk(spec.name, objectInput);
    if (riskBlocked) {
      return {
        toolName: spec.name,
        input: safeInput,
        ok: false,
        output: riskBlocked,
        durationMs: Math.round(performance.now() - started)
      };
    }

    const sensitiveBlocked = maybeBlockSensitiveRead(spec.name, objectInput);
    if (sensitiveBlocked) {
      return {
        toolName: spec.name,
        input: safeInput,
        ok: false,
        output: sensitiveBlocked,
        durationMs: Math.round(performance.now() - started)
      };
    }

    const tracker = new ChangeTracker(context.workspaceRoot);
    let mutation: MutationSnapshot | undefined;
    if (spec.name === "write_file" || spec.name === "edit_file") {
      const filePath = typeof objectInput["path"] === "string" ? objectInput["path"] : undefined;
      if (filePath) {
        mutation = await tracker.snapshotBeforeMutation(context.checkpointId, filePath, spec.name);
      }
    }
    const output = await dispatchTool(spec.name, objectInput, context.workspaceRoot);
    if (mutation) {
      await tracker.recordAfterMutation(mutation);
    }
    return {
      toolName: spec.name,
      input: safeInput,
      ok: true,
      output: redactSensitiveData(output),
      durationMs: Math.round(performance.now() - started)
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      toolName: spec.name,
      input: safeInput,
      ok: false,
      output: redactSensitiveText(message),
      durationMs: Math.round(performance.now() - started)
    };
  }
}

async function dispatchTool(
  name: string,
  input: Record<string, unknown>,
  workspaceRoot: string
): Promise<unknown> {
  switch (name) {
    case "read_file":
      return await readFileTool(input, workspaceRoot);
    case "write_file":
      return await writeFileTool(input, workspaceRoot);
    case "edit_file":
      return await editFileTool(input, workspaceRoot);
    case "list_dir":
      return await listDirTool(input, workspaceRoot);
    case "glob_search":
      return await globSearchTool(input, workspaceRoot);
    case "grep_search":
      return await grepSearchTool(input, workspaceRoot);
    case "shell":
      return await shellTool(input, workspaceRoot);
    case "python_exec":
      return await pythonExecTool(input, workspaceRoot);
    case "python_run_file":
      return await pythonRunFileTool(input, workspaceRoot);
    case "python_write_and_run":
      return await pythonWriteAndRunTool(input, workspaceRoot);
    case "python_analyze_result":
      return await pythonAnalyzeResultTool(input);
    case "python_last_result":
      return await pythonLastResultTool(input, workspaceRoot);
    case "python_clean_tmp":
      return await pythonCleanTool(input, workspaceRoot);
    case "python_risk":
      return await pythonRiskTool(input);
    case "git_status":
      return await gitStatusTool(input, workspaceRoot);
    case "git_diff":
      return await gitDiffTool(input, workspaceRoot);
    case "changes_summary":
      return await changesSummaryTool(input, workspaceRoot);
    case "checkpoint_create":
      return await checkpointCreateTool(input, workspaceRoot);
    case "revert_changes":
      return await revertChangesTool(input, workspaceRoot);
    case "git_commit_message":
      return await gitCommitMessageTool(input, workspaceRoot);
    case "risk_analyze":
      return await riskAnalyzeTool(input);
    case "task_plan":
      return await taskPlanTool(input, workspaceRoot);
    case "task_add":
      return await taskAddTool(input, workspaceRoot);
    case "task_update":
      return await taskUpdateTool(input, workspaceRoot);
    case "task_reset":
      return await taskResetTool(input, workspaceRoot);
    case "task_resume":
      return await taskResumeTool(input, workspaceRoot);
    case "project_profile":
      return await projectProfileTool(input, workspaceRoot);
    case "validation_plan":
      return await validationPlanTool(input, workspaceRoot);
    case "parse_errors":
      return await parseErrorsTool(input);
    case "symbol_index":
      return await symbolIndexTool(input, workspaceRoot);
    case "symbol_search":
      return await symbolSearchTool(input, workspaceRoot);
    case "find_definition":
      return await findDefinitionTool(input, workspaceRoot);
    case "find_references":
      return await findReferencesTool(input, workspaceRoot);
    case "analyze_imports":
      return await analyzeImportsTool(input, workspaceRoot);
    case "call_graph":
      return await callGraphTool(input, workspaceRoot);
    case "code_outline":
      return await codeOutlineTool(input, workspaceRoot);
    case "project_init":
      return await projectInitTool(input, workspaceRoot);
    case "context_monitor":
      return await contextMonitorTool(input, workspaceRoot);
    case "resume_state":
      return await resumeStateTool(input, workspaceRoot);
    case "structured_output":
      return { ok: true, data: input };
    case "fetch_url":
      return await fetchUrlTool(input);
    case "web_search":
      return await webSearchTool(input);
    case "ccr_retrieve":
      return await ccrRetrieveTool(input, workspaceRoot);
    case "memory_search":
      return await memorySearchTool(input, workspaceRoot);
    case "memory_write":
      return await memoryWriteTool(input, workspaceRoot);
    case "rag_index":
      return await ragIndexTool(input, workspaceRoot);
    case "rag_search":
      return await ragSearchTool(input, workspaceRoot);
    case "skill_list":
      return await skillListTool(input, workspaceRoot);
    case "skill_search":
      return await skillSearchTool(input, workspaceRoot);
    case "skill_read":
      return await skillReadTool(input, workspaceRoot);
    case "skill_use":
      return await skillUseTool(input, workspaceRoot);
    case "skill_create":
      return await skillCreateTool(input, workspaceRoot);
    case "skill_reload":
      return await skillReloadTool(input, workspaceRoot);
    case "skill_init":
      return await skillInitTool(input, workspaceRoot);
    default:
      throw new Error(`unhandled tool: ${name}`);
  }
}

function maybeBlockByRisk(toolName: string, input: Record<string, unknown>): unknown | undefined {
  if (toolName !== "shell") {
    return undefined;
  }
  const command = typeof input["command"] === "string" ? input["command"] : "";
  const report = analyzeCommandRisk(command);
  if (!report.blocked) {
    return undefined;
  }
  return {
    kind: "command_risk_blocked",
    ...report,
    message: "Command blocked by safety policy. Use /risk to inspect it; destructive and credential-risk commands require an explicit safer workflow."
  };
}

function maybeBlockSensitiveRead(toolName: string, input: Record<string, unknown>): unknown | undefined {
  if (toolName !== "read_file") {
    return undefined;
  }
  const filePath = typeof input["path"] === "string" ? input["path"] : "";
  if (!filePath || !isSensitivePath(filePath)) {
    return undefined;
  }
  return {
    kind: "sensitive_path_blocked",
    path: filePath,
    message: "Sensitive files such as .env, SSH keys, cookies, and credential stores are not read by default."
  };
}
