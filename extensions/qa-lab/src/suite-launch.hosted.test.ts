// Qa Lab tests cover hosted transport suite lifecycle behavior.
import type { QaRunnerCliRegistration } from "openclaw/plugin-sdk/qa-runner-runtime";
import { describe, expect, it, vi } from "vitest";
import { runQaHostedTransportSuite } from "./suite-launch.runtime.js";

function createFactory(params: {
  cleanup?: () => Promise<void>;
  run: () => Promise<void>;
}): NonNullable<QaRunnerCliRegistration["factory"]> {
  return {
    id: "matrix",
    matches: ({ channelId, driver }) => channelId === "matrix" && driver === "live",
    async create() {
      return {
        kind: "hosted",
        id: "matrix",
        run: params.run,
        cleanup: params.cleanup,
      };
    },
  };
}

describe("hosted transport suite", () => {
  it("runs and cleans up the adapter selected by the canonical registry", async () => {
    const run = vi.fn(async () => undefined);
    const cleanup = vi.fn(async () => undefined);

    await runQaHostedTransportSuite("matrix", { scenarioIds: ["matrix-canary"] }, [
      createFactory({ run, cleanup }),
    ]);

    expect(run).toHaveBeenCalledOnce();
    expect(cleanup).toHaveBeenCalledOnce();
  });

  it("preserves both run and cleanup failures", async () => {
    const error = await runQaHostedTransportSuite("matrix", {}, [
      createFactory({
        async run() {
          throw new Error("scenario failed");
        },
        async cleanup() {
          throw new Error("cleanup failed");
        },
      }),
    ]).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(AggregateError);
    expect(error).toMatchObject({
      errors: [
        expect.objectContaining({ message: "scenario failed" }),
        expect.objectContaining({ message: "cleanup failed" }),
      ],
    });
  });

  it("normalizes falsy adapter rejections instead of reporting success", async () => {
    const cleanup = vi.fn(async () => undefined);
    const run = vi.fn().mockRejectedValue(undefined);

    await expect(
      runQaHostedTransportSuite("matrix", {}, [
        createFactory({
          run,
          cleanup,
        }),
      ]),
    ).rejects.toThrow("undefined");
    expect(cleanup).toHaveBeenCalledOnce();
  });

  it("cleans up before normalizing rejection values with throwing coercion", async () => {
    const cleanup = vi.fn(async () => undefined);
    const rejection = {
      toString() {
        throw new Error("coercion failed");
      },
    };
    const run = vi.fn().mockRejectedValue(rejection);

    await expect(
      runQaHostedTransportSuite("matrix", {}, [
        createFactory({
          run,
          cleanup,
        }),
      ]),
    ).rejects.toThrow("non-Error rejection");
    expect(cleanup).toHaveBeenCalledOnce();
  });
});
