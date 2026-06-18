import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  analyzeImports,
  buildCallGraph,
  buildSymbolIndex,
  findDefinitions,
  searchSymbols
} from "../src/core/symbolIndex.js";

test("symbol_search finds TypeScript functions and classes", async () => {
  const workspace = await createSymbolWorkspace();
  await buildSymbolIndex(workspace);

  const classes = await searchSymbols(workspace, { query: "Greeter", kind: "class" });
  const functions = await searchSymbols(workspace, { query: "runGreeter", kind: "function" });

  assert.equal(classes[0]?.name, "Greeter");
  assert.equal(classes[0]?.file, "src/index.ts");
  assert.equal(functions[0]?.name, "runGreeter");
});

test("find_definition returns file path and line number", async () => {
  const workspace = await createSymbolWorkspace();
  await buildSymbolIndex(workspace);

  const definitions = await findDefinitions(workspace, "runGreeter");

  assert.equal(definitions.length, 1);
  assert.equal(definitions[0]?.file, "src/index.ts");
  assert.equal(definitions[0]?.line, 9);
});

test("analyze_imports parses import/export entries", async () => {
  const workspace = await createSymbolWorkspace();
  await buildSymbolIndex(workspace);

  const imports = await analyzeImports(workspace, "src/index.ts");

  assert.equal(imports.some((item) => item.kind === "import" && item.source === "./helper" && item.names.includes("helper")), true);
  assert.equal(imports.some((item) => item.kind === "export" && item.names.includes("helper")), true);
});

test("call_graph records simple TypeScript call edges", async () => {
  const workspace = await createSymbolWorkspace();
  await buildSymbolIndex(workspace);

  const edges = await buildCallGraph(workspace, "greet");

  assert.equal(edges.some((edge) => edge.caller === "Greeter.greet" && edge.callee === "helper"), true);
});

test("symbol index skips node_modules and dist", async () => {
  const workspace = await createSymbolWorkspace();
  await mkdir(path.join(workspace, "node_modules", "pkg"), { recursive: true });
  await mkdir(path.join(workspace, "dist"), { recursive: true });
  await writeFile(path.join(workspace, "node_modules", "pkg", "ignored.ts"), "export class IgnoredPackage {}\n", "utf8");
  await writeFile(path.join(workspace, "dist", "ignored.ts"), "export function ignoredDist() {}\n", "utf8");

  const index = await buildSymbolIndex(workspace);

  assert.equal(index.files.some((file) => file.includes("node_modules")), false);
  assert.equal(index.files.some((file) => file.startsWith("dist/")), false);
  assert.equal(index.symbols.some((symbol) => symbol.name === "IgnoredPackage" || symbol.name === "ignoredDist"), false);
});

async function createSymbolWorkspace(): Promise<string> {
  const workspace = await mkdtemp(path.join(os.tmpdir(), "code-agent-symbols-"));
  await mkdir(path.join(workspace, "src"), { recursive: true });
  await writeFile(
    path.join(workspace, "src", "helper.ts"),
    [
      "export function helper(name: string): string {",
      "  return `hello ${name}`;",
      "}",
      ""
    ].join("\n"),
    "utf8"
  );
  await writeFile(
    path.join(workspace, "src", "index.ts"),
    [
      "import { helper } from \"./helper\";",
      "export { helper } from \"./helper\";",
      "",
      "export class Greeter {",
      "  greet(name: string): string {",
      "    return helper(name);",
      "  }",
      "}",
      "export function runGreeter(): string {",
      "  const greeter = new Greeter();",
      "  return greeter.greet(\"Ada\");",
      "}",
      ""
    ].join("\n"),
    "utf8"
  );
  return workspace;
}
