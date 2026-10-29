export interface NormalizedToolCallAlias {
  name: string;
  input: Record<string, unknown>;
  aliasedFrom?: string;
}

export function normalizeToolCallAlias(name: string, input: Record<string, unknown>): NormalizedToolCallAlias {
  const normalizedInput = normalizeToolInputAliases(input);
  const original = name.trim();
  const normalizedName = original.toLowerCase().replace(/[\s-]+/g, "_");
  const action = toolAction(normalizedInput);
  const mapped = mapToolName(normalizedName, action, normalizedInput);
  return {
    name: mapped,
    input: normalizeInputForTool(mapped, normalizedInput),
    ...(mapped !== original ? { aliasedFrom: original } : {})
  };
}

export function unknownToolMessage(name: string): string {
  return [
    `Unknown tool: ${name}`,
    "Use an exact registered tool name. Common choices: read_file, list_dir, grep_search, glob_search, write_file, edit_file, file_exists, shell, python_exec, python_run_file."
  ].join("\n");
}

function normalizeToolInputAliases(input: Record<string, unknown>): Record<string, unknown> {
  let output = { ...input };
  output = copyAlias(output, "file_path", "path");
  output = copyAlias(output, "filepath", "path");
  output = copyAlias(output, "filename", "path");
  output = copyAlias(output, "file", "path");
  output = copyAlias(output, "directory", "path");
  output = copyAlias(output, "dir", "path");
  output = copyAlias(output, "folder", "path");
  output = copyAlias(output, "new_path", "newPath");
  output = copyAlias(output, "destination", "newPath");
  output = copyAlias(output, "dest", "newPath");
  output = copyAlias(output, "old_string", "oldString");
  output = copyAlias(output, "new_string", "newString");
  output = copyAlias(output, "cmd", "command");
  output = copyAlias(output, "script", "code");
  return output;
}

function copyAlias(input: Record<string, unknown>, from: string, to: string): Record<string, unknown> {
  if (input[to] !== undefined || input[from] === undefined) {
    return input;
  }
  const { [from]: _ignored, ...rest } = input;
  return { ...rest, [to]: input[from] };
}

function toolAction(input: Record<string, unknown>): string {
  for (const key of ["operation", "action", "command", "mode", "type", "kind"]) {
    const value = input[key];
    if (typeof value === "string" && value.trim()) {
      return value.toLowerCase();
    }
  }
  return "";
}

function mapToolName(name: string, action: string, input: Record<string, unknown>): string {
  if (name === "file") {
    if (isAny(action, ["write", "create", "save", "replace"]) || typeof input["content"] === "string") {
      return "write_file";
    }
    if (isAny(action, ["edit", "modify", "patch"]) || input["oldString"] !== undefined || input["newString"] !== undefined) {
      return "edit_file";
    }
    if (isAny(action, ["delete", "remove", "rm", "unlink"])) {
      return "delete_file";
    }
    if (isAny(action, ["move", "rename", "mv"]) || input["newPath"] !== undefined) {
      return "move_file";
    }
    if (isAny(action, ["exists", "exist", "check", "stat"])) {
      return "file_exists";
    }
    if (isAny(action, ["list", "ls", "dir", "tree"])) {
      return "list_dir";
    }
    return "read_file";
  }
  if (isAny(name, ["read", "open", "cat", "readfile"])) {
    return "read_file";
  }
  if (isAny(name, ["list", "ls", "dir", "tree", "listdir"])) {
    return "list_dir";
  }
  if (isAny(name, ["grep", "search_text", "text_search"])) {
    return "grep_search";
  }
  if (isAny(name, ["glob", "find_file", "file_search"])) {
    return "glob_search";
  }
  if (isAny(name, ["bash", "powershell", "terminal", "command", "run_command", "cmd"])) {
    return "shell";
  }
  if (name === "python") {
    if (typeof input["path"] === "string") {
      return "python_run_file";
    }
    return "python_exec";
  }
  return name;
}

function normalizeInputForTool(name: string, input: Record<string, unknown>): Record<string, unknown> {
  if (name === "shell" && typeof input["command"] !== "string") {
    const commandText = typeof input["code"] === "string" ? input["code"] : typeof input["input"] === "string" ? input["input"] : undefined;
    return commandText ? { ...input, command: commandText } : input;
  }
  if (name === "python_exec" && typeof input["code"] !== "string" && typeof input["command"] === "string") {
    return { ...input, code: input["command"] };
  }
  if (name === "list_dir" && typeof input["path"] !== "string") {
    return { ...input, path: "." };
  }
  return input;
}

function isAny(value: string, candidates: string[]): boolean {
  return candidates.some((candidate) => value === candidate || value.includes(candidate));
}
