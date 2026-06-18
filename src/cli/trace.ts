import path from "node:path";
import type { ConversationMessage, RuntimeConfig, RuntimeTraceEvent, TurnSummary } from "../core/types.js";
import { decideSummary } from "../core/summaryPolicy.js";
import { compactTerminalOutput } from "./compact.js";
import { renderMarkdownForTerminal, shouldRenderTerminalMarkdown } from "./markdownRenderer.js";
import { renderAgentBlock, renderUserBlock } from "./terminalBlocks.js";

const ansi = {
  reset: "\x1b[0m",
  dim: "\x1b[2m",
  bold: "\x1b[1m",
  green: "\x1b[32m",
  blue: "\x1b[34m",
  grayBg: "\x1b[48;5;236m",
  red: "\x1b[31m"
};

export interface RenderTraceOptions {
  verbose?: boolean;
  transcriptHint?: string;
  thinkingDisplay?: RuntimeConfig["thinkingDisplay"];
}

export function renderPromptBox(prompt: string, useColor = shouldUseColor()): string {
  const width = Math.max(24, Math.min(96, visualLength(prompt) + 4));
  const top = `╭${"─".repeat(width)}╮`;
  const bottom = `╰${"─".repeat(width)}╯`;
  const content = `│ › ${padRight(prompt, width - 3)}│`;
  const box = [top, content, bottom].join("\n");
  return useColor ? `${ansi.grayBg}${box}${ansi.reset}` : box;
}

export function renderTrace(
  trace: RuntimeTraceEvent[] | undefined,
  useColor = shouldUseColor(),
  options: RenderTraceOptions = {}
): string {
  if (!trace || trace.length === 0) {
    return "";
  }
  const rendered = trace
    .map((event) => options.verbose ? renderVerboseTraceEvent(event, useColor) : renderNormalTraceEvent(event, useColor, options))
    .filter(Boolean);
  return rendered.join("\n");
}

export function renderInteractiveTurn(prompt: string, turn: TurnSummary, config: RuntimeConfig): string {
  const trace = renderTrace(turn.trace, shouldUseColor(), {
    verbose: Boolean(config.verbose),
    thinkingDisplay: config.thinkingDisplay
  });
  return [
    renderUserBlock(prompt, blockOptions(config)),
    "",
    trace,
    "",
    renderAssistantAnswer(turn, renderAnswerOptions(config, turn)),
    "",
    renderTokenUsageLine(turn, config),
    "",
    renderFooter(config)
  ].filter(Boolean).join("\n");
}

export function renderInteractiveAnswer(turn: TurnSummary, config: RuntimeConfig): string {
  return [
    "",
    renderAssistantAnswer(turn, renderAnswerOptions(config, turn)),
    "",
    renderTokenUsageLine(turn, config),
    "",
    renderFooter(config)
  ].join("\n");
}

export function renderAssistantAnswer(
  turn: TurnSummary,
  options: { includeSummary?: boolean; summaryStyle?: "none" | "brief" | "full"; dialogBlocks?: boolean; markdown?: boolean; useColor?: boolean; width?: number } = {}
): string {
  const rawAnswer = assistantText(turn);
  const summaryStyle = options.summaryStyle ?? (options.includeSummary ? "full" : "none");
  const answer = isRuntimeFallbackText(rawAnswer)
    ? renderRuntimeFallbackNotice(rawAnswer, summaryStyle)
    : rawAnswer;
  const summary = summaryStyle === "full"
    ? renderTurnOutcomeSummary(turn)
    : summaryStyle === "brief"
      ? renderTurnBriefSummary(turn)
      : "";
  const text = [answer || (summary ? "" : ""), summary].filter(Boolean).join("\n\n");
  if (!text) {
    return "";
  }
  const rendered = renderMaybeMarkdown(text, options);
  return options.dialogBlocks === false ? rendered : renderAgentBlock(rendered, {
    enabled: true,
    ...(options.useColor !== undefined ? { useColor: options.useColor } : {}),
    ...(options.width !== undefined ? { width: options.width } : {})
  });
}

export function renderTurnOutcomeSummary(turn: TurnSummary): string {
  const edits = collectEditedFiles(turn.toolResults);
  const validations = collectValidationCommands(turn.trace ?? []);
  const evidence = turn.semanticEvidence ?? [];
  const context = turn.contextReport;
  const failedValidations = validations.filter((item) => !item.ok);
  const lines = [
    "────────────────────────────────────────",
    "",
    "## 本轮总结",
    "",
    "任务目标：",
    `- ${turn.taskPlan?.prompt ?? "本轮用户请求"}`
  ];

  lines.push("", "执行计划：");
  if (turn.taskPlan) {
    lines.push(`- ${turn.taskPlan.status} (${turn.taskPlan.tasks.filter((task) => task.status === "done").length}/${turn.taskPlan.tasks.length})`);
    for (const task of turn.taskPlan.tasks) {
      const evidence = task.evidence ? `：${task.evidence}` : "";
      lines.push(`- [${task.status}] ${task.id} ${task.title}${evidence}`);
    }
  } else {
    lines.push("- 未生成显式 Plan/Todo。");
  }

  lines.push("", "代码语义依据：");
  if (evidence.length > 0) {
    for (const item of evidence) {
      lines.push(`- ${item}`);
    }
  } else {
    lines.push("- 本轮未调用 symbol index / definition / references / imports / call graph 工具。");
  }

  if (edits.length > 0) {
    lines.push("", "修改摘要：");
    for (const edit of edits) {
      lines.push("", `- ${edit.path}`, `  ${edit.summary}`);
    }
  } else {
    lines.push("", "修改摘要：", "- 未检测到本轮文件写入或编辑。");
  }

  lines.push("", "diff 摘要：");
  if (edits.length > 0) {
    for (const edit of edits) {
      lines.push(`- ${edit.path} (+${edit.additions} -${edit.deletions})`);
    }
  } else {
    lines.push("- 无本轮 Agent 文件 diff。");
  }

  lines.push("", "验证结果：");
  if (validations.length > 0) {
    lines.push("执行过的命令：");
    for (const validation of validations) {
      lines.push(`- ${validation.command}`);
    }
    lines.push("", failedValidations.length ? "验证未完全通过：" : "验证已通过：");
    for (const validation of validations) {
      lines.push(`- ${validation.command}${validation.ok ? "" : " 失败"}`);
    }
    if (failedValidations.length > 0) {
      lines.push("", "失败原因：");
      for (const validation of failedValidations) {
        lines.push(`- ${validation.summary}`);
      }
    }
  } else if (turn.validation?.commands.length) {
    lines.push("执行过的命令：");
    for (const command of turn.validation.commands) {
      lines.push(`- ${command.command}`);
    }
    lines.push("", turn.validation.status === "passed" ? "验证已通过：" : "验证未完全通过：");
    lines.push(`- ${turn.validation.message}`);
  } else {
    lines.push("- 本轮未运行验证命令。");
  }

  lines.push("", "上下文使用情况：");
  if (context) {
    lines.push(
      `- session: ${context.sessionId}`,
      `- messages: ${context.messages}, active estimate: ${context.estimatedActiveTokens}`,
      `- tool result ratio: ${Math.round(context.toolResultRatio * 100)}%`,
      `- compression: ${context.compressionMode}, compacted: ${context.compactionDetected ? "yes" : "no"}`,
      `- CCR cache entries: ${context.ccrEntries}`,
      `- cost: ${context.cost.estimatedUsd === undefined ? context.cost.note : `$${context.cost.estimatedUsd}`}`
    );
  } else {
    lines.push("- 未生成上下文监控报告。");
  }

  lines.push("", "可恢复状态：");
  lines.push(`- session: ${turn.sessionId}`);
  lines.push(turn.taskPlan ? `- plan: ${turn.taskPlan.status}` : "- plan: none");
  lines.push(edits.length ? `- changed files: ${edits.length}` : "- changed files: none");
  lines.push("- 可使用 /resume、/resume-task、/changes、/diff 继续查看或恢复。");

  if (turn.validation) {
    lines.push("", "是否需要用户介入：", turn.validation.needsUserIntervention ? "- 是" : "- 否");
    if (turn.validation.errors.length > 0) {
      lines.push("", "失败原因：");
      for (const error of turn.validation.errors.slice(0, 6)) {
        const location = error.file ? `${error.file}${error.line ? `:${error.line}` : ""}` : "unknown";
        lines.push(`- ${location} ${error.type}: ${error.message}`);
      }
    }
    lines.push("", "下一步建议：");
    lines.push(turn.validation.needsUserIntervention
      ? "- 查看失败原因，补充配置或手动处理阻塞项后再运行。"
      : "- 可以继续下一项任务或使用 /changes、/diff 检查变更。");
  } else {
    lines.push("", "是否需要用户介入：", "- 否", "", "下一步建议：", "- 可以继续下一项任务或运行验证命令。");
  }
  return lines.join("\n");
}

export function renderTurnBriefSummary(turn: TurnSummary): string {
  const edits = collectEditedFiles(turn.toolResults);
  const validations = collectValidationCommands(turn.trace ?? []);
  const pythonRuns = collectToolNames(turn.toolResults, (name) => name.startsWith("python_") && name !== "python_risk");
  const gitTools = collectToolNames(turn.toolResults, (name) =>
    ["git_status", "git_diff", "changes_summary", "checkpoint_create", "revert_changes", "git_commit_message"].includes(name)
  );
  const failures = collectToolFailures(turn.toolResults);
  const lines: string[] = [];

  if (failures.length > 0 || turn.validation?.status === "failed" || turn.validation?.status === "blocked") {
    lines.push("任务未完全完成。");
    for (const failure of failures.slice(0, 4)) {
      lines.push(`- ${failure}`);
    }
    if (turn.validation?.message) {
      lines.push(`- ${turn.validation.message}`);
    }
  } else if (edits.length > 0) {
    lines.push("已完成修改。");
  } else if (validations.length > 0 || turn.validation?.commands.length) {
    lines.push("验证已完成。");
  } else if (pythonRuns.length > 0) {
    lines.push("Python 执行已完成。");
  } else if (gitTools.length > 0) {
    lines.push("Git/变更检查已完成。");
  } else if (turn.taskPlan) {
    lines.push("计划任务已更新。");
  } else {
    return "";
  }

  if (edits.length > 0) {
    lines.push("", "改动：");
    for (const edit of edits.slice(0, 6)) {
      lines.push(`- ${edit.path} (+${edit.additions} -${edit.deletions})`);
    }
  }

  const validationLines = validations.length
    ? validations.map((validation) => `${validation.command}${validation.ok ? " passed" : " failed"}`)
    : turn.validation?.commands.map((command) => `${command.command}${command.ok ? " passed" : " failed"}`) ?? [];
  if (validationLines.length > 0) {
    lines.push("", "验证：", ...validationLines.slice(0, 6).map((line) => `- ${line}`));
  }

  if (pythonRuns.length > 0) {
    lines.push("", `Python：${pythonRuns.length} 次工具调用。`);
  }
  if (gitTools.length > 0) {
    lines.push("", `变更工具：${gitTools.join(", ")}。`);
  }
  return lines.join("\n");
}

export function renderFooter(config: RuntimeConfig, useColor = shouldUseColor()): string {
  const text = `${config.model}  ${path.resolve(config.workspaceRoot)}`;
  if (!useColor) {
    return text;
  }
  return `${ansi.bold}${ansi.green}${config.model}${ansi.reset}  ${ansi.green}${path.resolve(config.workspaceRoot)}${ansi.reset}`;
}

export function renderAnswerOptions(
  config: RuntimeConfig,
  turn?: TurnSummary
): { includeSummary: boolean; summaryStyle: "none" | "brief" | "full"; dialogBlocks: boolean; markdown: boolean; useColor: boolean; width: number } {
  const decision = turn ? decideSummary(turn, config.summaryMode ?? "auto") : undefined;
  return {
    includeSummary: Boolean(decision?.shouldShowSummary),
    summaryStyle: config.verbose ? "none" : decision?.style ?? "none",
    dialogBlocks: config.dialogBlocks !== false,
    markdown: shouldRenderTerminalMarkdown(config),
    useColor: shouldUseColor(),
    width: Math.max(40, process.stdout.columns ?? 100)
  };
}

export function renderTokenUsageLine(turn: TurnSummary, config: RuntimeConfig, useColor = shouldUseColor()): string {
  if (config.showTokenUsage === false) {
    return "";
  }
  const usage = turn.turnUsage ?? turn.assistantMessages.at(-1)?.usage;
  if (!usage) {
    return "";
  }
  const estimated = usage.estimated === true || usage.source === "estimated";
  const input = `${estimated ? "~" : ""}${formatInteger(usage.inputTokens)}`;
  const output = `${estimated ? "~" : ""}${formatInteger(usage.outputTokens)}`;
  const totalTokens = usage.inputTokens + usage.outputTokens;
  const total = `${estimated ? "~" : ""}${formatInteger(totalTokens)}`;
  const contextPercent = turn.contextReport
    ? Math.min(100, Math.round((turn.contextReport.estimatedActiveTokens / Math.max(1, config.maxBudgetTokens)) * 100))
    : undefined;
  const cost = turn.contextReport?.cost.estimatedUsd && turn.contextReport.cost.estimatedUsd > 0
    ? ` · cost $${turn.contextReport.cost.estimatedUsd.toFixed(4)}`
    : "";
  const line = `Tokens: input ${input} · output ${output} · total ${total}${estimated ? " estimated" : ""}${cost}${contextPercent !== undefined ? ` · context ${contextPercent}%` : ""}`;
  return useColor ? `${ansi.dim}${line}${ansi.reset}` : line;
}

function blockOptions(config: RuntimeConfig): { enabled: boolean; useColor: boolean; width: number } {
  return {
    enabled: config.dialogBlocks !== false,
    useColor: shouldUseColor(),
    width: Math.max(40, process.stdout.columns ?? 100)
  };
}

function renderMaybeMarkdown(
  text: string,
  options: { markdown?: boolean; useColor?: boolean; width?: number }
): string {
  if (!options.markdown) {
    return text;
  }
  return renderMarkdownForTerminal(text, {
    enabled: true,
    ...(options.useColor !== undefined ? { useColor: options.useColor } : {}),
    ...(options.width !== undefined ? { width: options.width } : {})
  });
}

function renderNormalTraceEvent(event: RuntimeTraceEvent, useColor: boolean, options: RenderTraceOptions): string {
  if (isInternalLabel(event.label)) {
    return "";
  }
  if (event.type === "info" && event.label === "skill") {
    const name = (event.detail ?? "").split(/\s+/, 1)[0] || "skill";
    return naturalBlock(`Skill(${name})`, `Loaded skill workflow${event.detail ? `: ${event.detail}` : ""}`, useColor);
  }
  if (event.type === "info" && event.label === "thinking") {
    if (options.thinkingDisplay === "off") {
      return "";
    }
    const detail = options.thinkingDisplay === "verbose" && event.detail
      ? event.detail
      : "reasoning received, hidden by default";
    return naturalBlock("Thinking", detail, useColor);
  }
  if (event.type === "running") {
    if (event.label === "shell") {
      return naturalBlock(`Running ${commandFromInput(event.input)}`, "", useColor);
    }
    return "";
  }
  if (event.type !== "ran") {
    return "";
  }
  return renderToolExecutionSummary(event.label, event.input, event.output, event.ok ?? true, event.durationMs, useColor, options);
}

function renderToolExecutionSummary(
  toolName: string,
  input: unknown,
  output: unknown,
  ok: boolean,
  durationMs: number | undefined,
  useColor: boolean,
  options: RenderTraceOptions
): string {
  if (!ok) {
    return naturalBlock(`${pastToolVerb(toolName)} failed`, compact(String(output ?? "")), useColor, false);
  }
  if (toolName === "read_file") {
    return renderReadFile(output, useColor);
  }
  if (toolName === "list_dir") {
    return renderListDir(output, useColor);
  }
  if (toolName === "grep_search") {
    return renderSearch(output, useColor, options);
  }
  if (toolName === "glob_search") {
    return renderGlob(output, useColor, options);
  }
  if (toolName === "shell") {
    return renderShell(input, output, durationMs, useColor, options);
  }
  if (toolName.startsWith("python_")) {
    return renderPythonTool(toolName, output, durationMs, useColor, options);
  }
  if (toolName === "write_file" || toolName === "edit_file") {
    return renderFileEdit(toolName, output, useColor);
  }
  if (toolName === "git_diff") {
    return renderGitDiff(output, useColor, options);
  }
  if (toolName === "git_status") {
    return renderGitStatus(output, useColor);
  }
  if (toolName === "changes_summary") {
    return renderChangesSummary(output, useColor);
  }
  if (toolName === "checkpoint_create") {
    return renderCheckpoint(output, useColor);
  }
  if (toolName === "revert_changes") {
    return renderRevert(output, useColor);
  }
  if (toolName === "git_commit_message") {
    return renderCommitMessage(output, useColor);
  }
  if (toolName === "risk_analyze") {
    return renderRisk(output, useColor);
  }
  if (toolName === "task_plan" || toolName === "task_add" || toolName === "task_update" || toolName === "task_resume") {
    return renderTaskTool(output, useColor);
  }
  if (toolName === "task_reset") {
    return naturalBlock("Reset task plan", "Current task plan cleared.", useColor);
  }
  if (toolName === "project_profile" || toolName === "validation_plan") {
    return renderProjectTool(output, useColor);
  }
  if (toolName === "parse_errors") {
    return renderParsedErrors(output, useColor);
  }
  if (
    toolName === "symbol_index" ||
    toolName === "symbol_search" ||
    toolName === "find_definition" ||
    toolName === "find_references" ||
    toolName === "analyze_imports" ||
    toolName === "call_graph" ||
    toolName === "code_outline"
  ) {
    return renderCodeIntelTool(toolName, output, useColor);
  }
  if (toolName === "project_init") {
    return renderProjectInitTool(output, useColor);
  }
  if (toolName === "context_monitor") {
    return renderContextMonitorTool(output, useColor);
  }
  if (toolName === "resume_state") {
    return renderResumeStateTool(output, useColor);
  }
  if (toolName.startsWith("skill_")) {
    return renderSkillTool(toolName, output, useColor);
  }
  if (toolName === "reviewed_changes") {
    return renderReviewedChanges(output, useColor, ok);
  }
  return naturalBlock(pastToolVerb(toolName), compact(String((output as Record<string, unknown> | undefined)?.["path"] ?? "")), useColor);
}

function renderReadFile(output: unknown, useColor: boolean): string {
  const object = asObject(output);
  const filePath = String(object["path"] ?? "file");
  const totalLines = Number(object["totalLines"] ?? object["numLines"] ?? 0);
  const numLines = Number(object["numLines"] ?? totalLines);
  const startLine = Number(object["startLine"] ?? 1);
  const header = `Read ${highlightPath(filePath, useColor)}`;
  const detail = [`${totalLines || numLines} lines`];
  if (totalLines > numLines) {
    detail.push(`Showing lines ${startLine}-${startLine + numLines - 1}`);
  } else if (totalLines > 80) {
    detail.push("Content omitted from normal view. Press Ctrl+T to view transcript");
  }
  return naturalBlock(header, detail.join("\n"), useColor);
}

function renderListDir(output: unknown, useColor: boolean): string {
  const object = asObject(output);
  const dirPath = String(object["path"] ?? "workspace");
  const entries = Array.isArray(object["entries"]) ? object["entries"] : [];
  return naturalBlock("Listed workspace", `${highlightPath(dirPath, useColor)}\n${entries.length} entries`, useColor);
}

function renderSearch(output: unknown, useColor: boolean, options: RenderTraceOptions): string {
  const object = asObject(output);
  const pattern = String(object["pattern"] ?? "");
  const root = String(object["root"] ?? "");
  const matches = Number(object["numMatches"] ?? object["numLines"] ?? 0);
  const content = String(object["content"] ?? "");
  const compacted = compactTerminalOutput(content, {
    maxLines: 8,
    headLines: 6,
    tailLines: 2,
    ...(options.transcriptHint !== undefined ? { transcriptHint: options.transcriptHint } : {})
  }).text;
  return naturalBlock(`Searched "${pattern}" in ${highlightPath(root, useColor)}`, `${matches} matches\n${compacted}`.trim(), useColor);
}

function renderGlob(output: unknown, useColor: boolean, options: RenderTraceOptions): string {
  const object = asObject(output);
  const pattern = String(object["pattern"] ?? "");
  const files = Array.isArray(object["files"]) ? object["files"].map(String) : [];
  const compacted = compactTerminalOutput(files.join("\n"), {
    maxLines: 8,
    headLines: 6,
    tailLines: 2,
    ...(options.transcriptHint !== undefined ? { transcriptHint: options.transcriptHint } : {})
  }).text;
  return naturalBlock(`Matched files "${pattern}"`, `${files.length} files\n${compacted}`.trim(), useColor);
}

function renderShell(
  input: unknown,
  output: unknown,
  durationMs: number | undefined,
  useColor: boolean,
  options: RenderTraceOptions
): string {
  const command = commandFromInput(input);
  const object = asObject(output);
  const code = Number(object["code"] ?? 0);
  const stdout = String(object["stdout"] ?? "");
  const stderr = String(object["stderr"] ?? "");
  const combined = [stdout, stderr].filter(Boolean).join("\n");
  const status = code === 0 ? `Passed in ${formatDuration(durationMs)}` : `Failed in ${formatDuration(durationMs)}`;
  const body: string[] = [status];
  if (combined.trim()) {
    const compacted = compactTerminalOutput(combined, {
      maxLines: 18,
      headLines: 8,
      tailLines: 8,
      ...(options.transcriptHint !== undefined ? { transcriptHint: options.transcriptHint } : {})
    });
    const lineCount = combined.split(/\r?\n/).length;
    body.push(`${lineCount} lines`, "", compacted.text);
  }
  if (code !== 0) {
    const errors = extractErrorSummary(combined);
    if (errors.length > 0) {
      body.push("", "Error summary:", ...errors.map((line) => `- ${line}`));
    }
  }
  return naturalBlock(`Ran ${command}`, body.join("\n"), useColor, code === 0);
}

function renderPythonTool(
  toolName: string,
  output: unknown,
  durationMs: number | undefined,
  useColor: boolean,
  options: RenderTraceOptions
): string {
  if (toolName === "python_clean_tmp") {
    const object = asObject(output);
    return naturalBlock(
      "Cleaned Python temp scripts",
      `${String(object["removed"] ?? 0)} files\n${String(object["path"] ?? ".code-agent/tmp")}`,
      useColor
    );
  }
  if (toolName === "python_last_result") {
    const object = asObject(output);
    if (object["ok"] === false && object["message"]) {
      return naturalBlock("Python last result", String(object["message"]), useColor, false);
    }
    return renderPythonExecution("Python last result", output, durationMs, useColor, options);
  }
  if (toolName === "python_analyze_result" || toolName === "python_risk") {
    const object = asObject(output);
    const blocked = object["blocked"] === true || object["ok"] === false;
    const reasons = Array.isArray(object["reasons"]) ? object["reasons"].map(String) : [];
    return naturalBlock(
      toolName === "python_risk" ? `Python risk ${String(object["level"] ?? "unknown")}` : "Analyzed Python result",
      reasons.length ? reasons.map((reason) => `- ${reason}`).join("\n") : String(object["summary"] ?? "ok"),
      useColor,
      !blocked
    );
  }
  return renderPythonExecution("Ran python", output, durationMs, useColor, options);
}

function renderPythonExecution(
  title: string,
  output: unknown,
  durationMs: number | undefined,
  useColor: boolean,
  options: RenderTraceOptions
): string {
  const object = asObject(output);
  const ok = object["ok"] !== false;
  const scriptPath = String(object["scriptPath"] ?? "");
  const stdout = String(object["stdout"] ?? "");
  const stderr = String(object["stderr"] ?? "");
  const combined = [stdout, stderr].filter(Boolean).join("\n");
  const body = [
    `${ok ? "Passed" : "Failed"} in ${formatDuration(Number(object["durationMs"] ?? durationMs ?? 0))}`,
    scriptPath ? highlightPath(scriptPath, useColor) : "",
    String(object["summary"] ?? "").trim()
  ].filter(Boolean);
  if (combined.trim()) {
    const compacted = compactTerminalOutput(combined, {
      maxLines: 18,
      headLines: 8,
      tailLines: 8,
      preserveErrorLines: true,
      ...(options.transcriptHint !== undefined ? { transcriptHint: options.transcriptHint } : {})
    });
    body.push("", compacted.text);
  }
  return naturalBlock(title, body.join("\n"), useColor, ok);
}

function renderFileEdit(toolName: string, output: unknown, useColor: boolean): string {
  const object = asObject(output);
  const filePath = String(object["path"] ?? "file");
  const diff = String(object["diff"] ?? "");
  const additions = diff.split(/\r?\n/).filter((line) => line.startsWith("+") && !line.startsWith("+++")).length;
  const deletions = diff.split(/\r?\n/).filter((line) => line.startsWith("-") && !line.startsWith("---")).length;
  const title = `${toolName === "write_file" ? "Edited" : "Edited"} ${highlightPath(filePath, useColor)} (+${additions} -${deletions})`;
  const diffLines = diff.split(/\r?\n/);
  const clipped = diffLines.slice(0, 80);
  const body = [
    ...clipped.map((line) => colorDiffLine(line, useColor)),
    ...(diffLines.length > 80 ? ["... diff truncated. Use /diff to view full changes"] : [])
  ].join("\n");
  return naturalBlock(title, body, useColor);
}

function renderGitDiff(output: unknown, useColor: boolean, options: RenderTraceOptions): string {
  const object = asObject(output);
  if (object["isGitRepo"] === false) {
    return naturalBlock("Git diff unavailable", String(object["message"] ?? "not a git repository"), useColor, false);
  }
  const diff = String(object["diff"] ?? "");
  const summary = asObject(object["summary"]);
  const compacted = compactTerminalOutput(diff, {
    maxLines: 80,
    headLines: 40,
    tailLines: 40,
    preserveDiffHunks: true,
    ...(options.transcriptHint !== undefined ? { transcriptHint: options.transcriptHint } : {})
  }).text;
  return naturalBlock(
    `Git diff (+${Number(summary["additions"] ?? 0)} -${Number(summary["deletions"] ?? 0)})`,
    diff.trim() ? compacted : "No tracked diff.",
    useColor
  );
}

function renderGitStatus(output: unknown, useColor: boolean): string {
  const object = asObject(output);
  if (object["isGitRepo"] === false) {
    return naturalBlock("Git status unavailable", String(object["message"] ?? "not a git repository"), useColor, false);
  }
  const files = Array.isArray(object["files"]) ? object["files"] : [];
  const body = files.length
    ? files.map((item) => {
      const file = asObject(item);
      return `${String(file["status"] ?? "?")} ${String(file["path"] ?? "")}`;
    }).join("\n")
    : "No changed files.";
  return naturalBlock("Listed git changes", `${files.length} files\n${body}`, useColor);
}

function renderChangesSummary(output: unknown, useColor: boolean): string {
  const object = asObject(output);
  const files = Array.isArray(object["files"]) ? object["files"] : [];
  const body = files.length
    ? files.map((item) => {
      const file = asObject(item);
      return `${String(file["status"] ?? "unknown")} ${String(file["path"] ?? "")}`;
    }).join("\n")
    : "No agent-tracked changes.";
  return naturalBlock("Agent changes", `${files.length} files\n${body}`, useColor);
}

function renderCheckpoint(output: unknown, useColor: boolean): string {
  const object = asObject(output);
  return naturalBlock("Created checkpoint", `${String(object["checkpointId"] ?? "")}\n${String(object["path"] ?? "")}`.trim(), useColor);
}

function renderRevert(output: unknown, useColor: boolean): string {
  const object = asObject(output);
  const reverted = Array.isArray(object["reverted"]) ? object["reverted"].map(String) : [];
  const skipped = Array.isArray(object["skipped"]) ? object["skipped"] : [];
  const lines = [
    `${reverted.length} reverted`,
    ...reverted.map((file) => `reverted ${file}`),
    ...skipped.map((item) => {
      const skip = asObject(item);
      return `skipped ${String(skip["path"] ?? "")}: ${String(skip["reason"] ?? "")}`;
    })
  ];
  return naturalBlock("Reverted agent changes", lines.join("\n"), useColor, skipped.length === 0);
}

function renderCommitMessage(output: unknown, useColor: boolean): string {
  const object = asObject(output);
  if (object["isGitRepo"] === false) {
    return naturalBlock("Commit message unavailable", String(object["message"] ?? "not a git repository"), useColor, false);
  }
  return naturalBlock("Commit message draft", String(object["message"] ?? ""), useColor);
}

function renderRisk(output: unknown, useColor: boolean): string {
  const object = asObject(output);
  const categories = Array.isArray(object["categories"]) ? object["categories"].join(", ") : "unknown";
  const reasons = Array.isArray(object["reasons"]) ? object["reasons"].map(String) : [];
  return naturalBlock(
    `Risk ${String(object["level"] ?? "unknown")}`,
    [`categories: ${categories}`, ...reasons.map((reason) => `- ${reason}`)].join("\n"),
    useColor,
    object["blocked"] !== true
  );
}

function renderTaskTool(output: unknown, useColor: boolean): string {
  const object = asObject(output);
  const plan = asObject(object["plan"]);
  const tasks = Array.isArray(plan["tasks"]) ? plan["tasks"] : [];
  const status = String(plan["status"] ?? "none");
  const lines = tasks.length
    ? tasks.map((item) => {
      const task = asObject(item);
      return `[${String(task["status"] ?? "?")}] ${String(task["id"] ?? "")} ${String(task["title"] ?? "")}`;
    })
    : ["No active task plan."];
  return naturalBlock(`Task plan ${status}`, lines.join("\n"), useColor, status !== "blocked" && status !== "failed");
}

function renderProjectTool(output: unknown, useColor: boolean): string {
  const object = asObject(output);
  const profile = asObject(object["profile"]);
  const commands = asObject(profile["commands"]);
  const lines = Object.entries(commands).map(([kind, command]) => `${kind}: ${String(command)}`);
  const warnings = Array.isArray(profile["warnings"]) ? profile["warnings"].map(String) : [];
  return naturalBlock(
    "Project command profile",
    [
      `Detected: ${Array.isArray(profile["detections"]) ? profile["detections"].length : 0}`,
      "Commands:",
      ...(lines.length ? lines : ["none"]),
      ...(warnings.length ? ["Warnings:", ...warnings] : [])
    ].join("\n"),
    useColor,
    lines.length > 0
  );
}

function renderParsedErrors(output: unknown, useColor: boolean): string {
  const object = asObject(output);
  const errors = Array.isArray(object["errors"]) ? object["errors"] : [];
  const lines = errors.length
    ? errors.map((item) => {
      const error = asObject(item);
      const file = String(error["file"] ?? "unknown");
      const line = error["line"] ? `:${String(error["line"])}` : "";
      return `${file}${line} ${String(error["type"] ?? "error")}: ${String(error["message"] ?? "")}`;
    })
    : ["No structured errors parsed."];
  return naturalBlock("Parsed errors", `${errors.length} errors\n${lines.join("\n")}`, useColor, errors.length === 0);
}

function renderCodeIntelTool(toolName: string, output: unknown, useColor: boolean): string {
  const object = asObject(output);
  if (toolName === "symbol_index") {
    return naturalBlock(
      "Indexed code symbols",
      [
        `${Number(object["files"] ?? 0)} files`,
        `${Number(object["symbols"] ?? 0)} symbols`,
        `${Number(object["imports"] ?? 0)} imports/exports`,
        `${Number(object["callGraphEdges"] ?? 0)} call graph edges`,
        String(object["path"] ?? ".code-agent/symbols/index.json")
      ].join("\n"),
      useColor
    );
  }
  if (toolName === "symbol_search") {
    const symbols = arrayObjects(object["symbols"]);
    return naturalBlock(
      "Searched code symbols",
      [`${symbols.length} matches`, ...symbols.slice(0, 12).map(formatSymbolLine)].join("\n"),
      useColor
    );
  }
  if (toolName === "find_definition") {
    const definitions = arrayObjects(object["definitions"]);
    return naturalBlock(
      `Found definitions for ${String(object["name"] ?? "symbol")}`,
      [`${definitions.length} definitions`, ...definitions.slice(0, 12).map(formatSymbolLine)].join("\n"),
      useColor,
      definitions.length > 0
    );
  }
  if (toolName === "find_references") {
    const references = arrayObjects(object["references"]);
    return naturalBlock(
      `Found references for ${String(object["name"] ?? "symbol")}`,
      [`${references.length} references`, ...references.slice(0, 12).map(formatReferenceLine)].join("\n"),
      useColor,
      references.length > 0
    );
  }
  if (toolName === "analyze_imports") {
    const imports = arrayObjects(object["imports"]);
    return naturalBlock(
      "Analyzed imports and exports",
      [`${imports.length} entries`, ...imports.slice(0, 12).map(formatImportLine)].join("\n"),
      useColor
    );
  }
  if (toolName === "call_graph") {
    const edges = arrayObjects(object["edges"]);
    return naturalBlock(
      "Built call graph",
      [`${edges.length} edges`, ...edges.slice(0, 12).map(formatCallEdgeLine)].join("\n"),
      useColor
    );
  }
  const outlines = arrayObjects(object["outline"]);
  return naturalBlock(
    "Built code outline",
    [`${outlines.length} files`, ...outlines.slice(0, 12).map(formatOutlineLine)].join("\n"),
    useColor
  );
}

function renderProjectInitTool(output: unknown, useColor: boolean): string {
  const result = asObject(asObject(output)["result"]);
  return naturalBlock(
    "Initialized project context",
    [
      `project: ${String(result["projectPath"] ?? ".code-agent/project.md")}`,
      `rules: ${String(result["rulesPath"] ?? ".code-agent/rules.md")}`,
      `commands: ${String(result["commandsPath"] ?? ".code-agent/commands.md")}`,
      `outline files: ${String(result["outlineFiles"] ?? 0)}`,
      ...arrayStrings(result["risks"]).map((risk) => `risk: ${risk}`)
    ].join("\n"),
    useColor
  );
}

function renderContextMonitorTool(output: unknown, useColor: boolean): string {
  const report = asObject(asObject(output)["report"]);
  return naturalBlock(
    "Checked context usage",
    [
      `session: ${String(report["sessionId"] ?? "unknown")}`,
      `messages: ${String(report["messages"] ?? 0)}`,
      `active estimate: ${String(report["estimatedActiveTokens"] ?? 0)}`,
      `tool ratio: ${Math.round(Number(report["toolResultRatio"] ?? 0) * 100)}%`,
      `CCR entries: ${String(report["ccrEntries"] ?? 0)}`
    ].join("\n"),
    useColor
  );
}

function renderResumeStateTool(output: unknown, useColor: boolean): string {
  const state = asObject(asObject(output)["state"]);
  const changedFiles = Array.isArray(state["changedFiles"]) ? state["changedFiles"] : [];
  const commands = Array.isArray(state["executedCommands"]) ? state["executedCommands"] : [];
  return naturalBlock(
    "Loaded resume state",
    [
      `session: ${String(state["sessionId"] ?? "none")}`,
      `validation: ${String(state["validationStatus"] ?? "unknown")}`,
      `changed files: ${changedFiles.length}`,
      `commands: ${commands.length}`,
      ...arrayStrings(state["nextSteps"]).slice(0, 4).map((step) => `next: ${step}`)
    ].join("\n"),
    useColor
  );
}

function renderSkillTool(toolName: string, output: unknown, useColor: boolean): string {
  const object = asObject(output);
  if (toolName === "skill_list" || toolName === "skill_reload") {
    const skills = Array.isArray(object["skills"]) ? object["skills"] : [];
    const names = skills.map((item) => typeof item === "string" ? item : String(asObject(item)["name"] ?? "")).filter(Boolean);
    return naturalBlock("Listed skills", [`${names.length} skills`, ...names.slice(0, 12)].join("\n"), useColor);
  }
  if (toolName === "skill_search") {
    const matches = arrayObjects(object["matches"]);
    return naturalBlock(
      `Searched skills "${String(object["query"] ?? "")}"`,
      [`${matches.length} matches`, ...matches.slice(0, 12).map((match) => `${String(match["name"] ?? "")} (${String(match["score"] ?? 0)})`)].join("\n"),
      useColor
    );
  }
  if (toolName === "skill_init") {
    return naturalBlock(
      "Initialized skills",
      [
        `created: ${arrayStrings(object["created"]).join(", ") || "none"}`,
        `skipped: ${arrayStrings(object["skipped"]).join(", ") || "none"}`,
        String(object["path"] ?? ".code-agent/skills")
      ].join("\n"),
      useColor
    );
  }
  if (toolName === "skill_create") {
    return naturalBlock(`Created skill ${String(object["name"] ?? "")}`, String(object["path"] ?? ""), useColor);
  }
  return naturalBlock(
    `Loaded skill ${String(object["name"] ?? "")}`,
    [
      String(object["description"] ?? ""),
      `tools: ${arrayStrings(object["tools"]).join(", ") || "none"}`,
      String(object["path"] ?? "")
    ].filter(Boolean).join("\n"),
    useColor
  );
}

function renderReviewedChanges(output: unknown, useColor: boolean, ok: boolean): string {
  const object = asObject(output);
  const issues = arrayStrings(object["issues"]);
  const nextActions = arrayStrings(object["nextActions"]);
  return naturalBlock(
    "Reviewed changes",
    [
      `verdict: ${String(object["verdict"] ?? "unknown")}`,
      ...(issues.length ? ["Issues:", ...issues.map((issue) => `- ${issue}`)] : ["No blocking issues found."]),
      ...(nextActions.length ? ["Next actions:", ...nextActions.map((action) => `- ${action}`)] : [])
    ].join("\n"),
    useColor,
    ok
  );
}

function naturalBlock(title: string, body: string, useColor: boolean, ok = true): string {
  const marker = useColor ? `${ok ? ansi.green : ansi.red}●${ansi.reset}` : "●";
  const renderedBody = body
    .split(/\r?\n/)
    .filter((line, index, lines) => line || index !== lines.length - 1)
    .map((line, index) => `${index === 0 ? "  ⎿ " : "    "}${line}`)
    .join("\n");
  return renderedBody ? `${marker} ${title}\n${renderedBody}` : `${marker} ${title}`;
}

function renderVerboseTraceEvent(event: RuntimeTraceEvent, useColor: boolean): string {
  const prefix = event.type === "running" ? "Running" : event.type === "ran" ? "Ran" : "Info";
  const marker = event.type === "ran" && event.ok === false ? "×" : "•";
  const duration = event.type === "ran" && event.durationMs !== undefined ? ` ${event.durationMs}ms` : "";
  const detail = event.detail ? ` ${event.detail}` : "";
  const line = `${marker} ${prefix} ${event.label}${detail}${duration}`;

  if (!useColor) {
    return line;
  }
  if (event.type === "running") {
    return `${ansi.blue}${marker}${ansi.reset} ${ansi.bold}${prefix}${ansi.reset} ${event.label}${ansi.dim}${detail}${duration}${ansi.reset}`;
  }
  if (event.type === "ran" && event.ok === false) {
    return `${ansi.red}${marker}${ansi.reset} ${ansi.bold}${prefix}${ansi.reset} ${event.label}${ansi.dim}${detail}${duration}${ansi.reset}`;
  }
  if (event.type === "ran") {
    return `${ansi.green}${marker}${ansi.reset} ${ansi.bold}${prefix}${ansi.reset} ${event.label}${ansi.dim}${detail}${duration}${ansi.reset}`;
  }
  return `${ansi.dim}${line}${ansi.reset}`;
}

function collectEditedFiles(messages: ConversationMessage[]): Array<{ path: string; summary: string; additions: number; deletions: number }> {
  const edits: Array<{ path: string; summary: string; additions: number; deletions: number }> = [];
  for (const message of messages) {
    for (const block of message.blocks) {
      if (block.type !== "tool_result" || (block.toolName !== "write_file" && block.toolName !== "edit_file") || block.isError) {
        continue;
      }
      const object = asObject(block.output);
      const diff = String(object["diff"] ?? "");
      const additions = diff.split(/\r?\n/).filter((line) => line.startsWith("+") && !line.startsWith("+++")).length;
      const deletions = diff.split(/\r?\n/).filter((line) => line.startsWith("-") && !line.startsWith("---")).length;
      edits.push({
        path: String(object["path"] ?? block.toolName),
        summary: `更新文件内容（+${additions} -${deletions}）。`,
        additions,
        deletions
      });
    }
  }
  return edits;
}

function collectValidationCommands(trace: RuntimeTraceEvent[]): Array<{ command: string; ok: boolean; summary: string }> {
  const validations: Array<{ command: string; ok: boolean; summary: string }> = [];
  for (const event of trace) {
    if (event.type !== "ran" || event.label !== "shell") {
      continue;
    }
    const command = commandFromInput(event.input);
    if (!isValidationCommand(command)) {
      continue;
    }
    validations.push({
      command,
      ok: event.ok !== false,
      summary: summarizeShellFailure(event.output)
    });
  }
  return validations;
}

function collectToolNames(messages: ConversationMessage[], predicate: (toolName: string) => boolean): string[] {
  const names = new Set<string>();
  for (const message of messages) {
    for (const block of message.blocks) {
      if (block.type === "tool_result" && predicate(block.toolName)) {
        names.add(block.toolName);
      }
    }
  }
  return [...names];
}

function collectToolFailures(messages: ConversationMessage[]): string[] {
  const failures: string[] = [];
  for (const message of messages) {
    for (const block of message.blocks) {
      if (block.type === "tool_result" && block.isError) {
        failures.push(`${block.toolName}: ${compact(String(typeof block.output === "string" ? block.output : JSON.stringify(block.output)))}`);
      }
    }
  }
  return failures;
}

function summarizeShellFailure(output: unknown): string {
  const object = asObject(output);
  const combined = [String(object["stderr"] ?? ""), String(object["stdout"] ?? "")].filter(Boolean).join("\n");
  return extractErrorSummary(combined)[0] ?? "命令返回失败状态。";
}

function isValidationCommand(command: string): boolean {
  return /\b(npm\s+(run\s+)?(test|typecheck)|npm\s+test|pytest|py_compile|tsc|python\b.*py_compile)\b/i.test(command);
}

function isInternalLabel(label: string): boolean {
  return new Set(["route", "coordinator", "planner", "reflection", "reflection_policy", "memory", "rag", "goals", "save", "llm", "recovery", "checkpoint", "plan", "validation"]).has(label);
}

function pastToolVerb(toolName: string): string {
  const names: Record<string, string> = {
    read_file: "Read file",
    list_dir: "Listed directory",
    grep_search: "Searched text",
    glob_search: "Matched files",
    write_file: "Edited file",
    edit_file: "Edited file",
    shell: "Ran command",
    python_exec: "Ran Python snippet",
    python_run_file: "Ran Python file",
    python_write_and_run: "Wrote and ran Python script",
    python_analyze_result: "Analyzed Python result",
    python_last_result: "Showed Python result",
    python_clean_tmp: "Cleaned Python temp",
    python_risk: "Analyzed Python risk",
    fetch_url: "Fetched URL",
    web_search: "Searched web",
    memory_search: "Searched memory",
    memory_write: "Updated memory",
    rag_index: "Indexed workspace",
    rag_search: "Searched RAG",
    git_status: "Listed git changes",
    git_diff: "Showed git diff",
    changes_summary: "Summarized agent changes",
    checkpoint_create: "Created checkpoint",
    revert_changes: "Reverted changes",
    git_commit_message: "Drafted commit message",
    risk_analyze: "Analyzed risk",
    task_plan: "Showed task plan",
    task_add: "Added task",
    task_update: "Updated task",
    task_reset: "Reset task plan",
    task_resume: "Resumed task plan",
    project_profile: "Detected project profile",
    validation_plan: "Planned validation",
    parse_errors: "Parsed errors",
    symbol_index: "Indexed code symbols",
    symbol_search: "Searched code symbols",
    find_definition: "Found definitions",
    find_references: "Found references",
    analyze_imports: "Analyzed imports",
    call_graph: "Built call graph",
    code_outline: "Built code outline",
    project_init: "Initialized project",
    context_monitor: "Checked context",
    resume_state: "Loaded resume state",
    skill_list: "Listed skills",
    skill_search: "Searched skills",
    skill_read: "Read skill",
    skill_use: "Loaded skill",
    skill_create: "Created skill",
    skill_reload: "Reloaded skills",
    skill_init: "Initialized skills",
    reviewed_changes: "Reviewed changes"
  };
  return names[toolName] ?? toolName;
}

function arrayObjects(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.filter((item): item is Record<string, unknown> => Boolean(item && typeof item === "object")) : [];
}

function arrayStrings(value: unknown): string[] {
  return Array.isArray(value) ? value.map(String) : [];
}

function formatSymbolLine(item: Record<string, unknown>): string {
  const name = String(item["name"] ?? "symbol");
  const kind = String(item["kind"] ?? "unknown");
  return `${String(item["file"] ?? "unknown")}:${String(item["line"] ?? "?")} ${kind} ${name}`;
}

function formatReferenceLine(item: Record<string, unknown>): string {
  return `${String(item["file"] ?? "unknown")}:${String(item["line"] ?? "?")} ${String(item["text"] ?? item["name"] ?? "")}`;
}

function formatImportLine(item: Record<string, unknown>): string {
  const source = item["source"] ? ` from ${String(item["source"])}` : "";
  const names = Array.isArray(item["names"]) ? item["names"].map(String).join(", ") : "";
  return `${String(item["file"] ?? "unknown")}:${String(item["line"] ?? "?")} ${String(item["kind"] ?? "import")}${source} ${names}`.trim();
}

function formatCallEdgeLine(item: Record<string, unknown>): string {
  return `${String(item["file"] ?? "unknown")}:${String(item["line"] ?? "?")} ${String(item["caller"] ?? "?")} -> ${String(item["callee"] ?? "?")}`;
}

function formatOutlineLine(item: Record<string, unknown>): string {
  const symbols = Array.isArray(item["symbols"]) ? item["symbols"].length : 0;
  const imports = Array.isArray(item["imports"]) ? item["imports"].length : 0;
  return `${String(item["file"] ?? "unknown")} ${symbols} symbols, ${imports} imports`;
}

function commandFromInput(input: unknown): string {
  const object = asObject(input);
  return compact(String(object["command"] ?? input ?? ""));
}

function asObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? value as Record<string, unknown> : {};
}

function extractErrorSummary(output: string): string[] {
  return output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => /\b(error|failed|failure|exception|traceback|assertion|expected|received)\b/i.test(line))
    .slice(0, 6);
}

function highlightPath(value: string, useColor: boolean): string {
  return useColor ? `${ansi.blue}${value}${ansi.reset}` : value;
}

function colorDiffLine(line: string, useColor: boolean): string {
  if (!useColor) {
    return line;
  }
  if (line.startsWith("+") && !line.startsWith("+++")) {
    return `${ansi.green}${line}${ansi.reset}`;
  }
  if (line.startsWith("-") && !line.startsWith("---")) {
    return `${ansi.red}${line}${ansi.reset}`;
  }
  return line;
}

function assistantText(turn: TurnSummary): string {
  return turn.assistantMessages
    .flatMap((message) => message.blocks)
    .filter((block) => block.type === "text")
    .map((block) => block.text)
    .join("\n");
}

function isRuntimeFallbackText(value: string): boolean {
  return /^Prompt: .*\nRouted matches: .*\nTool observations:/s.test(value);
}

function renderRuntimeFallbackNotice(value: string, summaryStyle: "none" | "brief" | "full"): string {
  if (summaryStyle !== "none") {
    return "";
  }
  const unavailable = value.match(/LLM unavailable:\s*(.+)$/m)?.[1]?.trim();
  if (unavailable) {
    return `模型调用暂时不可用：${unavailable}`;
  }
  return "模型未返回可展示的回答。请检查当前模型配置，或使用 /profile 切换到可用模型。";
}

function shouldUseColor(): boolean {
  return Boolean(process.stdout.isTTY && process.env["NO_COLOR"] !== "1");
}

function formatDuration(ms: number | undefined): string {
  if (ms === undefined) {
    return "?";
  }
  return ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`;
}

function formatInteger(value: number): string {
  return Math.max(0, Math.round(value)).toLocaleString("en-US");
}

function compact(value: string, limit = 160): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized.length > limit ? `${normalized.slice(0, limit - 3)}...` : normalized;
}

function visualLength(value: string): number {
  let total = 0;
  for (const char of value) {
    total += char.charCodeAt(0) > 127 ? 2 : 1;
  }
  return total;
}

function padRight(value: string, width: number): string {
  const length = visualLength(value);
  return length >= width ? value : `${value}${" ".repeat(width - length)}`;
}
