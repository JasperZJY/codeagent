import { existsSync, realpathSync } from "node:fs";
import path from "node:path";

export interface PathScopeDecision {
  allowed: boolean;
  reason: string;
  candidate?: string;
  resolved?: string;
}

const WINDOWS_ABSOLUTE_RE = /^(?:[A-Za-z]:[\\/]|\\\\[^\\/]+[\\/][^\\/]+)/;

export class WorkspacePathScope {
  private readonly roots: string[];

  private constructor(roots: string[]) {
    this.roots = roots.map((root) => canonicalizePath(root));
  }

  static fromRoot(root: string): WorkspacePathScope {
    return new WorkspacePathScope([root]);
  }

  validatePayload(payload: string, cwd?: string): PathScopeDecision {
    const base = cwd ? path.resolve(cwd) : this.primaryRoot();
    const cwdDecision = this.validatePath(base);
    if (!cwdDecision.allowed) {
      const result: PathScopeDecision = {
        allowed: false,
        reason: `cwd outside workspace scope: ${base}`,
        candidate: base
      };
      if (cwdDecision.resolved) {
        result.resolved = cwdDecision.resolved;
      }
      return result;
    }
    for (const candidate of extractPathCandidates(payload)) {
      const decision = this.validatePath(candidate, base);
      if (!decision.allowed) {
        return decision;
      }
    }
    return { allowed: true, reason: "all path candidates are inside workspace scope" };
  }

  validatePath(candidate: string, cwd?: string): PathScopeDecision {
    if (WINDOWS_ABSOLUTE_RE.test(candidate) && !path.isAbsolute(candidate)) {
      return {
        allowed: false,
        reason: "windows absolute path is outside workspace scope",
        candidate,
        resolved: candidate
      };
    }
    const absolute = path.isAbsolute(candidate)
      ? path.resolve(candidate)
      : path.resolve(cwd ?? this.primaryRoot(), candidate);
    const resolved = canonicalizePathAllowMissing(absolute);
    const allowed = this.roots.some((root) => isInside(resolved, root));
    return {
      allowed,
      reason: allowed ? "path is inside workspace scope" : "path resolves outside workspace scope",
      candidate,
      resolved
    };
  }

  private primaryRoot(): string {
    const root = this.roots[0];
    if (!root) {
      throw new Error("workspace path scope requires at least one root");
    }
    return root;
  }
}

export function extractPathCandidates(payload: string): string[] {
  const tokens = tokenizeShellish(payload);
  const candidates: string[] = [];
  for (const raw of tokens) {
    const stripped = stripRedirection(raw);
    if (!stripped || stripped.startsWith("-") || /^[A-Za-z_][A-Za-z0-9_]*=/.test(stripped)) {
      continue;
    }
    const expanded = expandEnv(stripped);
    if (looksLikePath(stripped) || looksLikePath(expanded)) {
      const candidate = looksLikePath(expanded) ? expanded : stripped;
      if (!candidates.includes(candidate)) {
        candidates.push(candidate);
      }
    }
  }
  return candidates;
}

function tokenizeShellish(input: string): string[] {
  const tokens: string[] = [];
  let current = "";
  let quote: '"' | "'" | undefined;
  for (const char of input) {
    if ((char === '"' || char === "'") && quote === undefined) {
      quote = char;
      continue;
    }
    if (char === quote) {
      quote = undefined;
      continue;
    }
    if (/\s/.test(char) && quote === undefined) {
      if (current) {
        tokens.push(current);
        current = "";
      }
      continue;
    }
    current += char;
  }
  if (current) {
    tokens.push(current);
  }
  return tokens;
}

function stripRedirection(token: string): string {
  return token.replace(/^(?:\d*)?(?:<>|>>?|<)/, "").replace(/^&>>?/, "");
}

function looksLikePath(token: string): boolean {
  return (
    token === "." ||
    token === ".." ||
    token.startsWith("./") ||
    token.startsWith("../") ||
    token.startsWith("/") ||
    token.startsWith("~/") ||
    token.includes("/") ||
    token.includes("\\") ||
    token.includes("*") ||
    token.includes("?") ||
    WINDOWS_ABSOLUTE_RE.test(token)
  );
}

function expandEnv(value: string): string {
  return value
    .replace(/^~/, process.env["USERPROFILE"] ?? process.env["HOME"] ?? "~")
    .replace(/\$([A-Za-z_][A-Za-z0-9_]*)/g, (_, key: string) => process.env[key] ?? "")
    .replace(/%([A-Za-z_][A-Za-z0-9_]*)%/g, (_, key: string) => process.env[key] ?? "");
}

function canonicalizePath(value: string): string {
  const absolute = path.resolve(value);
  return existsSync(absolute) ? realpathSync.native(absolute) : absolute;
}

function canonicalizePathAllowMissing(value: string): string {
  if (existsSync(value)) {
    return realpathSync.native(value);
  }
  const parent = path.dirname(value);
  const base = path.basename(value);
  const parentResolved = existsSync(parent) ? realpathSync.native(parent) : path.resolve(parent);
  return path.join(parentResolved, base);
}

function isInside(candidate: string, root: string): boolean {
  const relative = path.relative(root, candidate);
  return relative === "" || (!!relative && !relative.startsWith("..") && !path.isAbsolute(relative));
}
