export type CommandRiskCategory =
  | "safe"
  | "write"
  | "network"
  | "destructive"
  | "credential-risk"
  | "system-risk";

export interface CommandRiskReport {
  command: string;
  categories: CommandRiskCategory[];
  level: "low" | "medium" | "high" | "blocked";
  blocked: boolean;
  requiresConfirmation: boolean;
  reasons: string[];
  redactedCommand: string;
}

const SENSITIVE_KEY_RE = /(api[_-]?key|token|password|passwd|secret|cookie|authorization|auth[_-]?token|private[_-]?key)/i;
const SENSITIVE_PATH_RE = /(^|[\\/])(\.env(\..*)?|\.npmrc|\.pypirc|\.netrc|id_rsa|id_ed25519|known_hosts|cookies?(\.sqlite)?|login data|keychain|credentials?)([\\/]|$)/i;

export function analyzeCommandRisk(command: string): CommandRiskReport {
  const normalized = command.trim();
  const lower = normalized.toLowerCase();
  const categories = new Set<CommandRiskCategory>();
  const reasons: string[] = [];

  if (/\b(rm\s+-[^\n;|&]*r[^\n;|&]*f|rm\s+-[^\n;|&]*f[^\n;|&]*r)\b/.test(lower)) {
    categories.add("destructive");
    reasons.push("recursive force delete");
  }
  if (/\bgit\s+reset\s+--hard\b/.test(lower)) {
    categories.add("destructive");
    reasons.push("hard git reset can discard work");
  }
  if (/\bgit\s+clean\s+-(?:[a-z]*f[a-z]*d|[a-z]*d[a-z]*f)\b/.test(lower)) {
    categories.add("destructive");
    reasons.push("git clean can delete untracked files");
  }
  if (/\b(remove-item|del|erase)\b.*\b(recurse|\/s)\b.*\b(force|\/q)\b/i.test(normalized)) {
    categories.add("destructive");
    reasons.push("recursive forced removal");
  }
  if (/\bsudo\b|\bset-executionpolicy\b|\bformat\b|\bdiskpart\b|\bbcdedit\b|\bchown\s+-r\b|\bchmod\s+-r\s+777\b/.test(lower)) {
    categories.add("system-risk");
    reasons.push("system-level command");
  }
  if (/\b(curl|wget|iwr|invoke-webrequest|fetch)\b/.test(lower) || /\b(npm|pnpm|yarn|pip|uv|go)\s+(install|add|get)\b/.test(lower) || /\bgit\s+clone\b/.test(lower)) {
    categories.add("network");
    reasons.push("network access");
  }
  if (/\b(curl|wget|iwr|invoke-webrequest)\b.*(\|\s*(sh|bash|powershell|pwsh|cmd)|iex\b)/.test(lower)) {
    categories.add("destructive");
    categories.add("network");
    reasons.push("remote script execution");
  }
  if (/\b(cat|type|get-content|gc|more|less|grep|rg|findstr)\b.*(\.env|id_rsa|id_ed25519|known_hosts|\.ssh|cookie|credentials?|login data)/i.test(normalized)) {
    categories.add("credential-risk");
    reasons.push("credential file access");
  }
  if (SENSITIVE_PATH_RE.test(normalized)) {
    categories.add("credential-risk");
    reasons.push("sensitive path reference");
  }
  if (/[>]{1,2}|\b(touch|mkdir|mv|move|cp|copy|sed\s+-i|git\s+(commit|checkout|restore|merge|rebase|apply))\b/i.test(normalized)) {
    categories.add("write");
    reasons.push("writes or changes files");
  }

  if (categories.size === 0) {
    categories.add("safe");
  }

  const blocked = categories.has("destructive") || categories.has("credential-risk");
  const requiresConfirmation = blocked || categories.has("system-risk");
  const level = blocked
    ? "blocked"
    : categories.has("system-risk")
      ? "high"
      : categories.has("write") || categories.has("network")
        ? "medium"
        : "low";

  return {
    command,
    categories: [...categories],
    level,
    blocked,
    requiresConfirmation,
    reasons: reasons.length ? unique(reasons) : ["no obvious risk"],
    redactedCommand: redactSensitiveText(command)
  };
}

export function isSensitivePath(value: string): boolean {
  return SENSITIVE_PATH_RE.test(value.replace(/\\/g, "/"));
}

export function redactSensitiveData<T>(value: T): T {
  return redactValue(value) as T;
}

export function redactSensitiveText(value: string): string {
  let output = value;
  output = output.replace(/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g, "[REDACTED_PRIVATE_KEY]");
  output = output.replace(/\bsk-[A-Za-z0-9_-]{8,}\b/g, (match) => maskSecret(match, "sk-"));
  output = output.replace(/\b(Bearer\s+)[A-Za-z0-9._~+/=-]{12,}\b/gi, (_match, prefix: string) => `${prefix}${maskSecret(String(_match).slice(prefix.length))}`);
  output = output.replace(/\b[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{10,}\b/g, (match) => maskSecret(match));
  output = output.replace(/((?:api[_-]?key|token|password|passwd|secret|cookie|authorization|auth[_-]?token)\s*[:=]\s*)(["']?)([^"'\s,;]{4,})(\2)/gi, (_match, prefix: string, quote: string, secret: string, suffix: string) => {
    if (/authorization/i.test(prefix) && /^bearer$/i.test(secret)) {
      return String(_match);
    }
    const visiblePrefix = secret.startsWith("sk-") ? "sk-" : "";
    return `${prefix}${quote}${maskSecret(secret, visiblePrefix)}${suffix}`;
  });
  return output;
}

function redactValue(value: unknown): unknown {
  if (typeof value === "string") {
    return redactSensitiveText(value);
  }
  if (Array.isArray(value)) {
    return value.map(redactValue);
  }
  if (value && typeof value === "object") {
    const output: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) {
      output[key] = SENSITIVE_KEY_RE.test(key) ? maskSecret(String(item ?? "")) : redactValue(item);
    }
    return output;
  }
  return value;
}

function maskSecret(value: string, visiblePrefix = ""): string {
  const source = value.startsWith(visiblePrefix) ? value.slice(visiblePrefix.length) : value;
  const tail = source.slice(-4);
  return `${visiblePrefix}****${tail}`;
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}
