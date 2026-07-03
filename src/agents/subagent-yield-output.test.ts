import { describe, expect, it } from "vitest";
import { isSessionsYieldToolResult } from "./subagent-yield-output.js";

describe("isSessionsYieldToolResult", () => {
  it("reads yielded status from valid JSON text only", () => {
    expect(
      isSessionsYieldToolResult({ role: "toolResult", content: '{"status":"yielded"}' }, true),
    ).toBe(true);
    expect(isSessionsYieldToolResult({ role: "toolResult", content: "{" }, true)).toBe(false);
    expect(isSessionsYieldToolResult({ role: "toolResult", content: "[]" }, true)).toBe(false);
  });
});
