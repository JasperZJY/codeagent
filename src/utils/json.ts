export function parseJsonPayload(payload: string): unknown {
  try {
    return JSON.parse(payload);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`invalid_json_payload: ${message}`);
  }
}

export function asObject(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("invalid_object_payload: expected a JSON object");
  }
  return value as Record<string, unknown>;
}

export function stringifyJson(value: unknown, pretty = true): string {
  return JSON.stringify(value, null, pretty ? 2 : 0);
}
