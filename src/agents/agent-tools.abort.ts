/**
 * Abort-signal wrapping for agent tools.
 * Combines per-call cancellation with run-level aborts while preserving plugin,
 * channel, and before_tool_call metadata on wrapped tools.
 */
import { copyPluginToolMeta } from "../plugins/tools.js";
import { bindAbortRelay } from "../utils/fetch-timeout.js";
import { copyBeforeToolCallHookMarker } from "./agent-tools.before-tool-call.js";
import type { AnyAgentTool } from "./agent-tools.types.js";
import { copyChannelAgentToolMeta } from "./channel-tools.js";

function throwAbortError(): never {
  const err = new Error("Aborted");
  err.name = "AbortError";
  throw err;
}

/**
 * Checks if an object is a valid AbortSignal using structural typing.
 * This is more reliable than `instanceof` across different realms (VM, iframe, etc.)
 * where the AbortSignal constructor may differ.
 */
function isAbortSignal(obj: unknown): obj is AbortSignal {
  return obj instanceof AbortSignal;
}

function combineAbortSignals(a?: AbortSignal, b?: AbortSignal): AbortSignal | undefined {
  if (!a && !b) {
    return undefined;
  }
  if (a && !b) {
    return a;
  }
  if (b && !a) {
    return b;
  }
  if (a?.aborted) {
    return a;
  }
  if (b?.aborted) {
    return b;
  }
  if (typeof AbortSignal.any === "function" && isAbortSignal(a) && isAbortSignal(b)) {
    return AbortSignal.any([a, b]);
  }

  const controller = new AbortController();
  const onAbort = bindAbortRelay(controller);
  a?.addEventListener("abort", onAbort, { once: true });
  b?.addEventListener("abort", onAbort, { once: true });
  return controller.signal;
}

function readToolExecute(tool: AnyAgentTool): AnyAgentTool["execute"] | undefined {
  try {
    const execute = tool.execute;
    return typeof execute === "function" ? execute : undefined;
  } catch {
    return undefined;
  }
}

function copyAbortWrappedToolMetadata(source: AnyAgentTool, target: AnyAgentTool): void {
  copyPluginToolMeta(source, target);
  copyChannelAgentToolMeta(source as never, target as never);
  copyBeforeToolCallHookMarker(source, target);
}

/** Wrap a tool so every execute call observes the supplied run abort signal. */
export function wrapToolWithAbortSignal(
  tool: AnyAgentTool,
  abortSignal?: AbortSignal,
): AnyAgentTool {
  if (!abortSignal) {
    return tool;
  }
  const execute = readToolExecute(tool);
  if (!execute) {
    return tool;
  }
  const wrappedTool = Object.create(tool) as AnyAgentTool;
  const wrappedExecute: AnyAgentTool["execute"] = async (toolCallId, params, signal, onUpdate) => {
    const combined = combineAbortSignals(signal, abortSignal);
    if (combined?.aborted) {
      throwAbortError();
    }
    return await Reflect.apply(execute, tool, [toolCallId, params, combined, onUpdate]);
  };
  Object.defineProperty(wrappedTool, "execute", {
    value: wrappedExecute,
    enumerable: true,
    configurable: true,
    writable: true,
  });
  copyAbortWrappedToolMetadata(tool, wrappedTool);
  return wrappedTool;
}
