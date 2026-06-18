import type { CodeImportExport, CodeOutline, CodeReference, CodeSymbol, CodeSymbolKind, CallGraphEdge, SymbolIndex } from "./types.js";
import {
  analyzeImports,
  buildCallGraph,
  buildCodeOutline,
  buildSymbolIndex,
  findDefinitions,
  findReferences,
  searchSymbols
} from "./symbolIndex.js";

export async function indexCode(workspaceRoot: string, pathInput = "."): Promise<SymbolIndex> {
  return await buildSymbolIndex(workspaceRoot, { path: pathInput });
}

export async function symbolSearch(
  workspaceRoot: string,
  query: string,
  options: { kind?: CodeSymbolKind; path?: string; limit?: number } = {}
): Promise<CodeSymbol[]> {
  return await searchSymbols(workspaceRoot, { query, ...options });
}

export async function definitionSearch(workspaceRoot: string, name: string, kind?: CodeSymbolKind): Promise<CodeSymbol[]> {
  return await findDefinitions(workspaceRoot, name, kind);
}

export async function referenceSearch(workspaceRoot: string, name: string, limit?: number): Promise<CodeReference[]> {
  return await findReferences(workspaceRoot, name, limit);
}

export async function importAnalysis(workspaceRoot: string, filePath?: string): Promise<CodeImportExport[]> {
  return await analyzeImports(workspaceRoot, filePath);
}

export async function callGraphAnalysis(workspaceRoot: string, symbol?: string): Promise<CallGraphEdge[]> {
  return await buildCallGraph(workspaceRoot, symbol);
}

export async function outlineAnalysis(workspaceRoot: string, filePath?: string): Promise<CodeOutline[]> {
  return await buildCodeOutline(workspaceRoot, filePath);
}

export function summarizeSemanticEvidence(symbols: CodeSymbol[], references: CodeReference[] = []): string[] {
  const symbolLines = symbols.slice(0, 8).map((symbol) =>
    `${symbol.kind} ${symbol.name} at ${symbol.file}:${symbol.line}`
  );
  const referenceLines = references.slice(0, 8).map((reference) =>
    `reference ${reference.name} at ${reference.file}:${reference.line}`
  );
  return [...symbolLines, ...referenceLines];
}
