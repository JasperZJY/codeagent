import { constants } from "node:fs";
import { access, mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import * as ts from "typescript";
import { WorkspacePathScope } from "./pathScope.js";
import type {
  CallGraphEdge,
  CodeImportExport,
  CodeOutline,
  CodeReference,
  CodeSymbol,
  CodeSymbolKind,
  SymbolIndex
} from "./types.js";

const SYMBOL_INDEX_VERSION = 1;
const SKIP_DIRS = new Set([".git", "node_modules", "dist", "build", "coverage", "__pycache__", "target", ".code-agent"]);
const CODE_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".py"]);

export interface SymbolQuery {
  query?: string;
  kind?: CodeSymbolKind;
  path?: string;
  limit?: number;
}

export async function buildSymbolIndex(workspaceRoot: string, input: { path?: string } = {}): Promise<SymbolIndex> {
  const root = resolveInWorkspace(workspaceRoot, input.path ?? ".");
  const files = await collectCodeFiles(root, workspaceRoot);
  const symbols: CodeSymbol[] = [];
  const imports: CodeImportExport[] = [];
  const callGraph: CallGraphEdge[] = [];

  for (const file of files) {
    const content = await readFile(file, "utf8");
    const relative = normalizeSlashes(path.relative(workspaceRoot, file));
    const analyzed = analyzeSource(relative, content);
    symbols.push(...analyzed.symbols);
    imports.push(...analyzed.imports);
    callGraph.push(...analyzed.callGraph);
  }

  const index: SymbolIndex = {
    version: SYMBOL_INDEX_VERSION,
    workspaceRoot: path.resolve(workspaceRoot),
    createdAt: new Date().toISOString(),
    files: files.map((file) => normalizeSlashes(path.relative(workspaceRoot, file))),
    symbols,
    imports,
    callGraph,
    skippedDirectories: [...SKIP_DIRS].sort()
  };
  await saveSymbolIndex(workspaceRoot, index);
  return index;
}

export async function loadOrBuildSymbolIndex(workspaceRoot: string): Promise<SymbolIndex> {
  const cached = await loadSymbolIndex(workspaceRoot);
  if (cached) {
    return cached;
  }
  return await buildSymbolIndex(workspaceRoot);
}

export async function loadSymbolIndex(workspaceRoot: string): Promise<SymbolIndex | undefined> {
  const target = symbolIndexPath(workspaceRoot);
  if (!(await exists(target))) {
    return undefined;
  }
  const parsed = JSON.parse(await readFile(target, "utf8")) as SymbolIndex;
  if (parsed.version !== SYMBOL_INDEX_VERSION || path.resolve(parsed.workspaceRoot) !== path.resolve(workspaceRoot)) {
    return undefined;
  }
  return parsed;
}

export async function searchSymbols(workspaceRoot: string, query: SymbolQuery): Promise<CodeSymbol[]> {
  const index = await loadOrBuildSymbolIndex(workspaceRoot);
  const needle = query.query?.toLowerCase().trim();
  const limit = normalizeLimit(query.limit);
  return index.symbols
    .filter((symbol) => !query.kind || symbol.kind === query.kind)
    .filter((symbol) => !query.path || normalizeSlashes(symbol.file).startsWith(normalizeSlashes(query.path ?? "")))
    .filter((symbol) => !needle || symbol.name.toLowerCase().includes(needle))
    .sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line || a.name.localeCompare(b.name))
    .slice(0, limit);
}

export async function findDefinitions(workspaceRoot: string, name: string, kind?: CodeSymbolKind): Promise<CodeSymbol[]> {
  return await searchSymbols(workspaceRoot, { query: name, ...(kind ? { kind } : {}), limit: 50 }).then((symbols) =>
    symbols.filter((symbol) => symbol.name === name || symbol.name.toLowerCase() === name.toLowerCase())
  );
}

export async function findReferences(workspaceRoot: string, name: string, limit = 100): Promise<CodeReference[]> {
  if (!name.trim()) {
    throw new Error("invalid_symbol_name");
  }
  const index = await loadOrBuildSymbolIndex(workspaceRoot);
  const refs: CodeReference[] = [];
  const word = new RegExp(`\\b${escapeRegExp(name)}\\b`, "g");
  for (const relative of index.files) {
    const absolute = resolveInWorkspace(workspaceRoot, relative);
    const content = await readFile(absolute, "utf8");
    const lines = content.split(/\r?\n/);
    for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
      const line = lines[lineIndex] ?? "";
      word.lastIndex = 0;
      let match = word.exec(line);
      while (match) {
        refs.push({
          name,
          file: relative,
          line: lineIndex + 1,
          column: match.index + 1,
          text: line.trim()
        });
        if (refs.length >= limit) {
          return refs;
        }
        match = word.exec(line);
      }
    }
  }
  return refs;
}

export async function analyzeImports(workspaceRoot: string, filePath?: string): Promise<CodeImportExport[]> {
  const index = await loadOrBuildSymbolIndex(workspaceRoot);
  if (!filePath) {
    return index.imports;
  }
  const relative = normalizeSlashes(path.relative(workspaceRoot, resolveInWorkspace(workspaceRoot, filePath)));
  return index.imports.filter((item) => item.file === relative);
}

export async function buildCallGraph(workspaceRoot: string, symbol?: string): Promise<CallGraphEdge[]> {
  const index = await loadOrBuildSymbolIndex(workspaceRoot);
  if (!symbol?.trim()) {
    return index.callGraph;
  }
  const needle = symbol.toLowerCase();
  return index.callGraph.filter((edge) =>
    edge.caller.toLowerCase().includes(needle) || edge.callee.toLowerCase().includes(needle)
  );
}

export async function buildCodeOutline(workspaceRoot: string, filePath?: string): Promise<CodeOutline[]> {
  const index = await loadOrBuildSymbolIndex(workspaceRoot);
  const files = filePath
    ? [normalizeSlashes(path.relative(workspaceRoot, resolveInWorkspace(workspaceRoot, filePath)))]
    : index.files;
  return files.map((file) => ({
    file,
    symbols: index.symbols.filter((symbol) => symbol.file === file),
    imports: index.imports.filter((item) => item.file === file)
  }));
}

function analyzeSource(file: string, content: string): { symbols: CodeSymbol[]; imports: CodeImportExport[]; callGraph: CallGraphEdge[] } {
  if (file.endsWith(".py")) {
    return analyzePythonSource(file, content);
  }
  return analyzeTypeScriptSource(file, content);
}

function analyzeTypeScriptSource(file: string, content: string): { symbols: CodeSymbol[]; imports: CodeImportExport[]; callGraph: CallGraphEdge[] } {
  const scriptKind = file.endsWith(".tsx") || file.endsWith(".jsx")
    ? ts.ScriptKind.TSX
    : file.endsWith(".js") || file.endsWith(".mjs") || file.endsWith(".cjs")
      ? ts.ScriptKind.JS
      : ts.ScriptKind.TS;
  const sourceFile = ts.createSourceFile(file, content, ts.ScriptTarget.Latest, true, scriptKind);
  const symbols: CodeSymbol[] = [];
  const imports: CodeImportExport[] = [];
  const callGraph: CallGraphEdge[] = [];
  const functionStack: string[] = [];
  const classStack: string[] = [];

  const addSymbol = (node: ts.Node, name: string, kind: CodeSymbolKind, extra: Partial<CodeSymbol> = {}): void => {
    const position = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
    const symbol: CodeSymbol = {
      name,
      kind,
      file,
      line: position.line + 1,
      column: position.character + 1,
      exported: isExported(node),
      ...extra
    };
    symbols.push(symbol);
  };

  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node)) {
      imports.push(importDeclarationToEntry(sourceFile, file, node));
    } else if (ts.isExportDeclaration(node)) {
      imports.push(exportDeclarationToEntry(sourceFile, file, node));
    } else if (ts.isFunctionDeclaration(node) && node.name) {
      addSymbol(node, node.name.text, "function", { signature: signatureText(sourceFile, node) });
      functionStack.push(node.name.text);
      ts.forEachChild(node, visit);
      functionStack.pop();
      return;
    } else if (ts.isClassDeclaration(node) && node.name) {
      addSymbol(node, node.name.text, "class", { signature: signatureText(sourceFile, node) });
      classStack.push(node.name.text);
      ts.forEachChild(node, visit);
      classStack.pop();
      return;
    } else if (ts.isMethodDeclaration(node) && node.name) {
      const name = propertyNameText(node.name);
      if (name) {
        const container = classStack.at(-1);
        addSymbol(node, name, "method", {
          ...(container ? { container } : {}),
          signature: signatureText(sourceFile, node)
        });
        functionStack.push(container ? `${container}.${name}` : name);
        ts.forEachChild(node, visit);
        functionStack.pop();
        return;
      }
    } else if (ts.isVariableStatement(node)) {
      for (const declaration of node.declarationList.declarations) {
        if (ts.isIdentifier(declaration.name)) {
          const declarationText = declaration.getText(sourceFile).split(/\r?\n/, 1)[0];
          addSymbol(declaration, declaration.name.text, isExported(node) ? "export" : "variable", declarationText ? {
            signature: declarationText
          } : {});
        }
      }
    } else if (ts.isCallExpression(node)) {
      const caller = functionStack.at(-1);
      const callee = callName(node.expression);
      if (caller && callee) {
        const position = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
        callGraph.push({
          caller,
          callee,
          file,
          line: position.line + 1
        });
      }
    }
    ts.forEachChild(node, visit);
  };

  visit(sourceFile);
  return { symbols, imports, callGraph };
}

function analyzePythonSource(file: string, content: string): { symbols: CodeSymbol[]; imports: CodeImportExport[]; callGraph: CallGraphEdge[] } {
  const symbols: CodeSymbol[] = [];
  const imports: CodeImportExport[] = [];
  const callGraph: CallGraphEdge[] = [];
  let currentFunction: string | undefined;
  const lines = content.split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    const trimmed = line.trim();
    const classMatch = trimmed.match(/^class\s+([A-Za-z_][\w]*)/);
    if (classMatch?.[1]) {
      symbols.push(symbol(file, classMatch[1], "class", index + 1, line.indexOf("class") + 1, false, trimmed));
      currentFunction = undefined;
      continue;
    }
    const defMatch = trimmed.match(/^def\s+([A-Za-z_][\w]*)\s*\(/);
    if (defMatch?.[1]) {
      symbols.push(symbol(file, defMatch[1], "function", index + 1, line.indexOf("def") + 1, false, trimmed));
      currentFunction = defMatch[1];
      continue;
    }
    const importMatch = trimmed.match(/^(from\s+([\w.]+)\s+import\s+(.+)|import\s+(.+))$/);
    if (importMatch) {
      imports.push({
        file,
        line: index + 1,
        kind: "import",
        ...(importMatch[2] ? { source: importMatch[2] } : {}),
        names: splitImportNames(importMatch[3] ?? importMatch[4] ?? ""),
        raw: trimmed
      });
    }
    if (currentFunction) {
      for (const match of trimmed.matchAll(/\b([A-Za-z_][\w]*)\s*\(/g)) {
        const callee = match[1];
        if (callee && callee !== "if" && callee !== "for" && callee !== "while") {
          callGraph.push({ caller: currentFunction, callee, file, line: index + 1 });
        }
      }
    }
  }
  return { symbols, imports, callGraph };
}

function importDeclarationToEntry(sourceFile: ts.SourceFile, file: string, node: ts.ImportDeclaration): CodeImportExport {
  const position = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
  const names: string[] = [];
  const clause = node.importClause;
  if (clause?.name) {
    names.push(clause.name.text);
  }
  if (clause?.namedBindings && ts.isNamedImports(clause.namedBindings)) {
    names.push(...clause.namedBindings.elements.map((element) => element.name.text));
  } else if (clause?.namedBindings && ts.isNamespaceImport(clause.namedBindings)) {
    names.push(clause.namedBindings.name.text);
  }
  const source = moduleSpecifierText(node.moduleSpecifier);
  return {
    file,
    line: position.line + 1,
    kind: "import",
    ...(source ? { source } : {}),
    names,
    raw: node.getText(sourceFile).split(/\r?\n/, 1)[0] ?? ""
  };
}

function exportDeclarationToEntry(sourceFile: ts.SourceFile, file: string, node: ts.ExportDeclaration): CodeImportExport {
  const position = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
  const names: string[] = [];
  if (node.exportClause && ts.isNamedExports(node.exportClause)) {
    names.push(...node.exportClause.elements.map((element) => element.name.text));
  }
  const source = node.moduleSpecifier ? moduleSpecifierText(node.moduleSpecifier) : undefined;
  return {
    file,
    line: position.line + 1,
    kind: "export",
    ...(source ? { source } : {}),
    names,
    raw: node.getText(sourceFile).split(/\r?\n/, 1)[0] ?? ""
  };
}

function symbol(file: string, name: string, kind: CodeSymbolKind, line: number, column: number, exported: boolean, signature: string): CodeSymbol {
  return { file, name, kind, line, column, exported, signature };
}

async function collectCodeFiles(root: string, workspaceRoot: string): Promise<string[]> {
  const metadata = await stat(root);
  if (metadata.isFile()) {
    return CODE_EXTENSIONS.has(path.extname(root)) ? [root] : [];
  }
  const files: string[] = [];
  const stack = [root];
  while (stack.length > 0) {
    const current = stack.pop();
    if (!current) {
      continue;
    }
    const entries = await readdir(current, { withFileTypes: true });
    for (const entry of entries) {
      const absolute = path.join(current, entry.name);
      const relativeParts = normalizeSlashes(path.relative(workspaceRoot, absolute)).split("/");
      if (entry.isDirectory()) {
        if (!SKIP_DIRS.has(entry.name) && !relativeParts.includes(".code-agent")) {
          stack.push(absolute);
        }
      } else if (entry.isFile() && CODE_EXTENSIONS.has(path.extname(entry.name))) {
        files.push(absolute);
      }
    }
  }
  return files.sort();
}

async function saveSymbolIndex(workspaceRoot: string, index: SymbolIndex): Promise<void> {
  await mkdir(path.join(workspaceRoot, ".code-agent", "symbols"), { recursive: true });
  await writeFile(symbolIndexPath(workspaceRoot), `${JSON.stringify(index, null, 2)}\n`, "utf8");
}

function symbolIndexPath(workspaceRoot: string): string {
  return path.join(workspaceRoot, ".code-agent", "symbols", "index.json");
}

function resolveInWorkspace(workspaceRoot: string, value: string): string {
  const decision = WorkspacePathScope.fromRoot(workspaceRoot).validatePath(value, workspaceRoot);
  if (!decision.allowed) {
    throw new Error(decision.reason);
  }
  return decision.resolved ?? path.resolve(workspaceRoot, value);
}

function isExported(node: ts.Node): boolean {
  return Boolean(ts.canHaveModifiers(node) && ts.getModifiers(node)?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword));
}

function propertyNameText(name: ts.PropertyName): string | undefined {
  if (ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name)) {
    return name.text;
  }
  return undefined;
}

function callName(expression: ts.Expression): string | undefined {
  if (ts.isIdentifier(expression)) {
    return expression.text;
  }
  if (ts.isPropertyAccessExpression(expression)) {
    return expression.name.text;
  }
  return undefined;
}

function moduleSpecifierText(node: ts.Expression): string | undefined {
  return ts.isStringLiteral(node) ? node.text : undefined;
}

function signatureText(sourceFile: ts.SourceFile, node: ts.Node): string {
  return node.getText(sourceFile).split(/\r?\n/, 1)[0]?.replace(/\s*\{?\s*$/, "") ?? "";
}

function splitImportNames(value: string): string[] {
  return value.split(",").map((item) => item.trim().split(/\s+as\s+/i).at(-1)?.trim()).filter((item): item is string => Boolean(item));
}

function normalizeLimit(value: number | undefined): number {
  return Math.max(1, Math.min(200, Math.floor(value ?? 50)));
}

function normalizeSlashes(value: string): string {
  return value.replace(/\\/g, "/");
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function exists(filePath: string): Promise<boolean> {
  try {
    await access(filePath, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}
