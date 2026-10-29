import { redactSensitiveText } from "./security.js";

const TEMP_TITLE_PREFIX = "新会话 ";

export function temporarySessionTitle(createdAt: string | Date = new Date()): string {
  const date = typeof createdAt === "string" ? new Date(createdAt) : createdAt;
  if (Number.isNaN(date.getTime())) {
    return `${TEMP_TITLE_PREFIX}${new Date().toISOString().slice(0, 16).replace("T", " ")}`;
  }
  return `${TEMP_TITLE_PREFIX}${date.toISOString().slice(0, 16).replace("T", " ")}`;
}

export function isTemporarySessionTitle(value: string | undefined): boolean {
  return !value || value.startsWith(TEMP_TITLE_PREFIX);
}

export function generateSessionTitleFallback(firstUserMessage: string, createdAt: string | Date = new Date()): string {
  const safe = normalizeSessionText(firstUserMessage)
    .replace(/^(请|请你|帮我|给我|你给我|please)\s*/i, "")
    .trim();
  if (!safe) {
    return temporarySessionTitle(createdAt);
  }

  const cjk = [...safe].filter((char) => /[\u3400-\u9fff]/u.test(char));
  if (cjk.length >= 4) {
    return cjk.slice(0, 18).join("") || temporarySessionTitle(createdAt);
  }

  const words = safe.match(/[A-Za-z0-9][A-Za-z0-9._-]*/g) ?? [];
  if (words.length > 0) {
    return words.slice(0, 8).join(" ");
  }

  return safe.slice(0, 40) || temporarySessionTitle(createdAt);
}

export function redactSessionText(text: string): string {
  return redactSensitiveText(text)
    .replace(/-----BEGIN [^-]*-----[\s\S]*?-----END [^-]*-----/g, "[REDACTED_PRIVATE_KEY]")
    .replace(/\bAuthorization\s*:\s*[^\s,;]+/gi, "Authorization: [REDACTED]")
    .replace(/\bCookie\s*:\s*[^\n]+/gi, "Cookie: [REDACTED]");
}

export function normalizeSessionText(text: string): string {
  return redactSessionText(text)
    .replace(/\r?\n+/g, " ")
    .replace(/[`*_#>[\]{}()]/g, " ")
    .replace(/[，。！？；：、,.!?;:"'\\|/]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
