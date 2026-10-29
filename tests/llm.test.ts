import test from "node:test";
import assert from "node:assert/strict";
import { LLM_UNAVAILABLE_MARKER, llmUnavailableReason } from "../src/core/llm.js";

test("llmUnavailableReason extracts the provider failure detail", () => {
  assert.equal(llmUnavailableReason("fallback answer\n\nLLM unavailable: fetch failed"), "fetch failed");
  assert.equal(llmUnavailableReason("fallback answer\n\nLLM unavailable: HTTP 502"), "HTTP 502");
  assert.equal(llmUnavailableReason("fallback answer\n\nLLM unavailable: request timed out after 50ms"), "request timed out after 50ms");
});

test("llmUnavailableReason ignores ordinary answers", () => {
  assert.equal(llmUnavailableReason("the build passed"), undefined);
  assert.equal(llmUnavailableReason(""), undefined);
  assert.equal(llmUnavailableReason("LLM unavailable:"), undefined);
  assert.equal(llmUnavailableReason("LLM unavailable:   "), undefined);
});

test("the fallback marker is stable because rendered output depends on it", () => {
  assert.equal(LLM_UNAVAILABLE_MARKER, "LLM unavailable:");
});
