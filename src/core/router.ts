import { commandCatalog, findCommand } from "./catalog.js";
import type { RoutedMatch } from "./types.js";
import { toolCatalog } from "../tools/registry.js";

export function routePrompt(prompt: string, limit = 10): RoutedMatch[] {
  const explicit = explicitCommandMatch(prompt);
  const tokens = tokenize(prompt);
  const commandMatches = scoreCommands(tokens);
  const intentMatches = inferIntentMatches(prompt);
  const toolMatches = scoreTools(tokens);
  const selected: RoutedMatch[] = [];

  if (explicit) {
    selected.push(explicit);
  }
  if (isWriteIntent(prompt)) {
    selected.push(toolMatch("write_file", 80));
  }
  const firstTool = [...intentMatches, ...toolMatches].find(
    (match, index, values) =>
      !selected.some((existing) => existing.kind === match.kind && existing.name === match.name) &&
      values.findIndex((value) => value.name === match.name) === index
  );
  if (firstTool) {
    selected.push(firstTool);
  }

  const leftovers = uniqueMatches([...commandMatches, ...intentMatches, ...toolMatches])
    .filter((match) => !selected.some((existing) => existing.kind === match.kind && existing.name === match.name))
    .sort((a, b) => b.score - a.score || a.kind.localeCompare(b.kind) || a.name.localeCompare(b.name));

  return [...selected, ...leftovers].slice(0, limit);
}

function explicitCommandMatch(prompt: string): RoutedMatch | undefined {
  const first = prompt.trim().split(/\s+/, 1)[0];
  if (!first?.startsWith("/")) {
    return undefined;
  }
  const command = findCommand(first.slice(1));
  if (!command) {
    return undefined;
  }
  return {
    kind: "command",
    name: command.name,
    score: 100,
    description: command.description
  };
}

function scoreCommands(tokens: Set<string>): RoutedMatch[] {
  return commandCatalog
    .map((command) => {
      const haystacks = [command.name, ...(command.aliases ?? []), command.description, command.category];
      return {
        kind: "command" as const,
        name: command.name,
        score: score(tokens, haystacks),
        description: command.description
      };
    })
    .filter((match) => match.score > 0)
    .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
}

function scoreTools(tokens: Set<string>): RoutedMatch[] {
  return toolCatalog
    .map((tool) => {
      const haystacks = [tool.name, tool.description, ...tool.routeHints];
      return {
        kind: "tool" as const,
        name: tool.name,
        score: score(tokens, haystacks),
        description: tool.description
      };
    })
    .filter((match) => match.score > 0)
    .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
}

function score(tokens: Set<string>, haystacks: string[]): number {
  let total = 0;
  const lowered = haystacks.map((value) => value.toLowerCase());
  for (const token of tokens) {
    if (lowered.some((value) => value.includes(token) || token.includes(value))) {
      total += token.length > 2 ? 2 : 1;
    }
  }
  return total;
}

function inferIntentMatches(prompt: string): RoutedMatch[] {
  const lowered = prompt.toLowerCase();
  const matches: RoutedMatch[] = [];
  if (/(https?:\/\/\S+)/i.test(prompt)) {
    matches.push(toolMatch("fetch_url", 48));
    return matches;
  }
  if (hasPathLike(prompt) && includesAny(lowered, ["delete", "remove", "rm ", "unlink", "删除", "移除"])) {
    matches.push(toolMatch("delete_file", 65));
  }
  if (hasPathLike(prompt) && includesAny(lowered, ["move", "rename", "mv ", "移动", "重命名", "改名"])) {
    matches.push(toolMatch("move_file", 64));
  }
  if (hasPathLike(prompt) && includesAny(lowered, ["exists", "exist", "check file", "path exists", "是否存在", "存在吗", "有没有"])) {
    matches.push(toolMatch("file_exists", 63));
  }
  if (includesAny(lowered, [
    "上网",
    "联网",
    "互联网",
    "网页搜索",
    "搜索网页",
    "新闻",
    "热点",
    "今日",
    "今天发生",
    "web search",
    "internet search",
    "latest",
    "current",
    "最新"
  ])) {
    matches.push(toolMatch("web_search", 45));
    return matches;
  }

  const asksProjectStructure =
    includesAny(lowered, [
      "项目结构",
      "工程结构",
      "目录结构",
      "项目目录",
      "工程目录",
      "仓库结构",
      "代码结构",
      "项目架构",
      "工程架构",
      "project structure",
      "repo structure",
      "repository structure"
    ]) ||
    (/分析.*(项目|工程|仓库|代码)/.test(lowered) && includesAny(lowered, ["结构", "目录", "架构"]));
  if (asksProjectStructure) {
    matches.push(toolMatch("list_dir", 55));
  }

  const hasLocalFileTarget = includesAny(lowered, [
    "本地",
    "文件",
    "目录",
    "工作区",
    "workspace",
    "file",
    "directory",
    "folder"
  ]);
  const asksReadOrList = includesAny(lowered, [
    "读",
    "读取",
    "阅读",
    "查看",
    "看看",
    "列出",
    "浏览",
    "访问",
    "read",
    "open",
    "show",
    "list"
  ]);

  if (hasLocalFileTarget && asksReadOrList) {
    if (hasPathLike(prompt)) {
      matches.push(toolMatch("read_file", 50));
    } else {
      matches.push(toolMatch("list_dir", 45));
    }
  }

  if (includesAny(lowered, ["搜索", "查找内容", "grep", "search text"])) {
    matches.push(toolMatch("grep_search", 40));
  } else if (includesAny(lowered, ["查找文件", "匹配文件", "find file", "glob"])) {
    matches.push(toolMatch("glob_search", 40));
  }

  if (includesAny(lowered, ["rag", "知识库", "检索", "索引"])) {
    matches.push(toolMatch(includesAny(lowered, ["index", "索引", "建立"]) ? "rag_index" : "rag_search", 42));
  }
  if (includesAny(lowered, ["记住", "记忆", "偏好", "经验", "学习"])) {
    matches.push(toolMatch(includesAny(lowered, ["记住", "写入", "保存", "learn"]) ? "memory_write" : "memory_search", 38));
  }

  return matches;
}

function isWriteIntent(prompt: string): boolean {
  const lowered = prompt.toLowerCase();
  const writeNeedles = [
    "write",
    "create",
    "save",
    "generate",
    "output to",
    "save as",
    "save to",
    "编写",
    "生成",
    "保存",
    "保存到",
    "保存在",
    "写入",
    "创建",
    "新建",
    "输出到",
    "存到",
    "放在",
    "放到"
  ];
  if (includesAny(lowered, writeNeedles)) {
    return true;
  }
  return includesAny(lowered, ["markdown", ".md", "md 文件", "md文件"]) &&
    includesAny(lowered, ["保存", "写入", "生成", "创建", "输出", "存到", "放到", "save", "write", "create"]);
}

function toolMatch(name: string, score: number): RoutedMatch {
  const tool = toolCatalog.find((entry) => entry.name === name);
  return {
    kind: "tool",
    name,
    score,
    description: tool?.description ?? name
  };
}

function includesAny(value: string, needles: string[]): boolean {
  return needles.some((needle) => value.includes(needle));
}

function uniqueMatches(matches: RoutedMatch[]): RoutedMatch[] {
  const seen = new Set<string>();
  const output: RoutedMatch[] = [];
  for (const match of matches) {
    const key = `${match.kind}:${match.name}`;
    if (!seen.has(key)) {
      seen.add(key);
      output.push(match);
    }
  }
  return output;
}

function hasPathLike(prompt: string): boolean {
  return /(?:\.{1,2}[\\/]|[A-Za-z]:[\\/]|[\w.-]+[\\/])[\w./\\-]+|[\w.-]+\.(?:ts|tsx|js|json|py|md|rs|toml|txt)/i.test(prompt);
}

function tokenize(prompt: string): Set<string> {
  return new Set(
    prompt
      .toLowerCase()
      .replace(/[/"'`:,()[\]{}]/g, " ")
      .split(/\s+/)
      .map((token) => token.trim())
      .filter(Boolean)
  );
}
