/**
 * Unit coverage for abort-signal wrapping around runtime tools.
 */
import type { AgentTool } from "openclaw/plugin-sdk/agent-core";
import { Type } from "typebox";
import { describe, expect, it, vi } from "vitest";
import { wrapToolWithAbortSignal } from "./agent-tools.abort.js";

function createTool(name = "abort_safe"): AgentTool {
  return {
    name,
    label: name,
    description: "abort-safe tool",
    parameters: Type.Object({}),
    execute: vi.fn(async () => ({ content: [], details: { ok: true } })),
  };
}

describe("wrapToolWithAbortSignal", () => {
  it("skips tools with unreadable or non-callable execute handlers", () => {
    const abortSignal = new AbortController().signal;
    const unreadableExecute = {
      name: "bad_execute",
      label: "Bad Execute",
      description: "throws while reading execute",
      parameters: Type.Object({}),
    } as AgentTool;
    Object.defineProperty(unreadableExecute, "execute", {
      get() {
        throw new Error("revoked execute");
      },
    });
    const nonCallableExecute = {
      ...createTool("non_callable_execute"),
      execute: "not a function",
    } as unknown as AgentTool;

    expect(wrapToolWithAbortSignal(unreadableExecute, abortSignal)).toBe(unreadableExecute);
    expect(wrapToolWithAbortSignal(nonCallableExecute, abortSignal)).toBe(nonCallableExecute);
  });

  it("does not enumerate hostile tool metadata while wrapping a readable executor", async () => {
    const tool = createTool();
    const hostileTool = new Proxy(tool, {
      ownKeys() {
        throw new Error("metadata enumeration revoked");
      },
    });
    const abortSignal = new AbortController().signal;

    const wrapped = wrapToolWithAbortSignal(hostileTool, abortSignal);

    expect(Object.is(wrapped, hostileTool)).toBe(false);
    expect(wrapped.name).toBe("abort_safe");
    await wrapped.execute("call-abort", {}, undefined, undefined);
    const execute = vi.mocked(tool.execute);
    expect(execute).toHaveBeenCalledTimes(1);
    expect(execute.mock.calls[0]?.[2]).toBeInstanceOf(AbortSignal);
  });
});
