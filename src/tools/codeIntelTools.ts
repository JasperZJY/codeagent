import type { CodeSymbolKind } from "../core/types.js";
import {
  callGraphAnalysis,
  definitionSearch,
  importAnalysis,
  indexCode,
  outlineAnalysis,
  referenceSearch,
  symbolSearch
} from "../core/codeAnalyzer.js";

export async function symbolSearchTool(input: Record<string, unknown>, workspaceRoot: string): Promise<unknown> {
  const query = optionalString(input, "query") ?? "";
  const kind = optionalSymbolKind(input["kind"]);
  const path = optionalString(input, "path");
  const limit = optionalNumber(input, "limit");
  return {
    kind: "symbol_search",
    symbols: await symbolSearch(workspaceRoot, query, {
      ...(kind ? { kind } : {}),
      ...(path ? { path } : {}),
      ...(limit ? { limit } : {})
    })
  };
}

export async function findDefinitionTool(input: Record<string, unknown>, workspaceRoot: string): Promise<unknown> {
  const name = requireString(input, "name");
  const kind = optionalSymbolKind(input["kind"]);
  return {
    kind: "definitions",
    name,
    definitions: await definitionSearch(workspaceRoot, name, kind)
  };
}

export async function findReferencesTool(input: Record<string, unknown>, workspaceRoot: string): Promise<unknown> {
  const name = requireString(input, "name");
  return {
    kind: "references",
    name,
    references: await referenceSearch(workspaceRoot, name, optionalNumber(input, "limit"))
  };
}

export async function analyzeImportsTool(input: Record<string, unknown>, workspaceRoot: string): Promise<unknown> {
  return {
    kind: "imports",
    imports: await importAnalysis(workspaceRoot, optionalString(input, "path"))
  };
}

export async function callGraphTool(input: Record<string, unknown>, workspaceRoot: string): Promise<unknown> {
  return {
    kind: "call_graph",
    edges: await callGraphAnalysis(workspaceRoot, optionalString(input, "symbol"))
  };
}

export async function codeOutlineTool(input: Record<string, unknown>, workspaceRoot: string): Promise<unknown> {
  return {
    kind: "code_outline",
    outline: await outlineAnalysis(workspaceRoot, optionalString(input, "path"))
  };
}

export async function symbolIndexTool(input: Record<string, unknown>, workspaceRoot: string): Promise<unknown> {
  const index = await indexCode(workspaceRoot, optionalString(input, "path") ?? ".");
  return {
    kind: "symbol_index",
    files: index.files.length,
    symbols: index.symbols.length,
    imports: index.imports.length,
    callGraphEdges: index.callGraph.length,
    skippedDirectories: index.skippedDirectories,
    path: ".code-agent/symbols/index.json"
  };
}

function requireString(input: Record<string, unknown>, key: string): string {
  const value = input[key];
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`invalid_tool_input: '${key}' must be a non-empty string`);
  }
  return value.trim();
}

function optionalString(input: Record<string, unknown>, key: string): string | undefined {
  const value = input[key];
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function optionalNumber(input: Record<string, unknown>, key: string): number | undefined {
  const value = input[key];
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function optionalSymbolKind(value: unknown): CodeSymbolKind | undefined {
  if (
    value === "function" ||
    value === "class" ||
    value === "method" ||
    value === "variable" ||
    value === "export" ||
    value === "import"
  ) {
    return value;
  }
  return undefined;
}
