import { describe, expect, it, vi } from "vitest";
import { CodexAppServerRpcError, type CodexAppServerClient } from "./client.js";
import type { CodexServerNotification } from "./protocol.js";
import { readCodexNativeContextUsage, resumeCodexAppServerThread } from "./thread-resume.js";

function resumeResponse(threadId: string, restoredTurns = 0) {
  return {
    thread: {
      id: threadId,
      sessionId: "session-1",
      forkedFromId: null,
      preview: "",
      ephemeral: false,
      modelProvider: "openai",
      createdAt: 1,
      updatedAt: 1,
      status: { type: "idle" },
      path: null,
      cwd: "/repo",
      cliVersion: "0.139.0",
      source: "unknown",
      agentNickname: null,
      agentRole: null,
      gitInfo: null,
      name: null,
      turns: Array.from({ length: restoredTurns }, (_, index) => ({
        id: `turn-${index}`,
        items: [],
        status: "completed",
        error: null,
      })),
    },
    model: "gpt-5.5-codex",
    modelProvider: "openai",
    serviceTier: null,
    cwd: "/repo",
    instructionSources: [],
    approvalPolicy: "never",
    approvalsReviewer: "user",
    sandbox: { type: "dangerFullAccess" },
    permissionProfile: null,
    reasoningEffort: null,
  };
}

function createClient(requestImpl: (params: unknown) => unknown) {
  const handlers = new Set<(notification: CodexServerNotification) => void>();
  const request = vi.fn(async (_method: string, params: unknown) => await requestImpl(params));
  const client = {
    request,
    addNotificationHandler: vi.fn((handler: (notification: CodexServerNotification) => void) => {
      handlers.add(handler);
      return () => handlers.delete(handler);
    }),
  } as unknown as CodexAppServerClient;
  return {
    client,
    request,
    emit(notification: CodexServerNotification) {
      for (const handler of handlers) {
        handler(notification);
      }
    },
  };
}

describe("resumeCodexAppServerThread", () => {
  it("reads current-context usage instead of cumulative thread usage", () => {
    expect(
      readCodexNativeContextUsage({
        method: "thread/tokenUsage/updated",
        params: {
          tokenUsage: {
            total: { totalTokens: 900_000 },
            last: { totalTokens: 42_000 },
            modelContextWindow: 258_400,
          },
        },
      }),
    ).toEqual({ currentTokens: 42_000, modelContextWindow: 258_400 });
  });

  it("leaves a proven RPC rejection on the reusable client", async () => {
    const rejection = new CodexAppServerRpcError(
      { code: -32_000, message: "thread not found" },
      "thread/resume",
    );
    const { client } = createClient(async () => {
      throw rejection;
    });
    const abandonClient = vi.fn(async () => undefined);

    await expect(
      resumeCodexAppServerThread({
        client,
        abandonClient,
        request: { threadId: "thread-1", excludeTurns: true },
      }),
    ).rejects.toBe(rejection);
    expect(abandonClient).not.toHaveBeenCalled();
  });

  it("retires the exact client when resume acceptance is indeterminate", async () => {
    const { client } = createClient(async () => {
      throw new Error("thread/resume timed out");
    });
    const abandonClient = vi.fn(async () => undefined);

    await expect(
      resumeCodexAppServerThread({
        client,
        abandonClient,
        request: { threadId: "thread-1", excludeTurns: true },
      }),
    ).rejects.toThrow("thread/resume timed out");
    expect(abandonClient).toHaveBeenCalledOnce();
  });

  it("retires the exact client when the response names another thread", async () => {
    const { client } = createClient(async () => resumeResponse("thread-2"));
    const abandonClient = vi.fn(async () => undefined);

    await expect(
      resumeCodexAppServerThread({
        client,
        abandonClient,
        request: { threadId: "thread-1", excludeTurns: true },
      }),
    ).rejects.toThrow("returned thread-2 for thread-1");
    expect(abandonClient).toHaveBeenCalledOnce();
  });

  it("restores native usage by temporarily including turns", async () => {
    const harness = createClient(async () => {
      queueMicrotask(() =>
        harness.emit({
          method: "thread/tokenUsage/updated",
          params: {
            threadId: "thread-1",
            tokenUsage: {
              total: { totalTokens: 900_000 },
              last: { totalTokens: 12_000 },
              modelContextWindow: 258_400,
            },
          },
        }),
      );
      return resumeResponse("thread-1", 1);
    });

    await expect(
      resumeCodexAppServerThread({
        client: harness.client,
        abandonClient: async () => undefined,
        request: { threadId: "thread-1", excludeTurns: true },
        refreshNativeContextUsage: true,
      }),
    ).resolves.toMatchObject({
      nativeContextUsage: { currentTokens: 12_000, modelContextWindow: 258_400 },
    });
    expect(harness.request).toHaveBeenCalledWith(
      "thread/resume",
      { threadId: "thread-1", excludeTurns: false },
      {},
    );
  });

  it("does not retire a proven resume when usage waiting is aborted", async () => {
    const { client } = createClient(async () => resumeResponse("thread-1", 1));
    const abandonClient = vi.fn(async () => undefined);
    const controller = new AbortController();
    const resumed = resumeCodexAppServerThread({
      client,
      abandonClient,
      request: { threadId: "thread-1" },
      refreshNativeContextUsage: true,
      signal: controller.signal,
    });
    controller.abort(new Error("cancelled after resume"));

    await expect(resumed).rejects.toThrow("cancelled after resume");
    expect(abandonClient).not.toHaveBeenCalled();
  });
});
