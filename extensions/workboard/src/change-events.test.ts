// Workboard change event tests cover lifecycle fanout and external reconciliation.
import { describe, expect, it, vi } from "vitest";
import { createWorkboardChangeEventService } from "./change-events.js";
import type { WorkboardStore } from "./store.js";

describe("createWorkboardChangeEventService", () => {
  it("emits local changes and checks for commits from other processes", async () => {
    vi.useFakeTimers();
    const unsubscribe = vi.fn();
    let listener: ((change: { epoch: string; revision: number }) => void) | undefined;
    const announceChangeEpoch = vi.fn(() => listener?.({ epoch: "epoch-a", revision: 1 }));
    const reconcileExternalChanges = vi.fn();
    const store = {
      subscribeChanges: vi.fn((next) => {
        listener = next;
        return unsubscribe;
      }),
      announceChangeEpoch,
      reconcileExternalChanges,
    } as unknown as WorkboardStore;
    const emit = vi.fn();
    const service = createWorkboardChangeEventService(store);
    const ctx = {
      config: {},
      stateDir: "/tmp/workboard-change-events-test",
      gatewayEvents: { emit },
      logger: {
        debug: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
      },
    } satisfies Parameters<typeof service.start>[0];

    await service.start(ctx);
    listener?.({ epoch: "epoch-a", revision: 2 });
    await vi.advanceTimersByTimeAsync(1000);

    expect(emit).toHaveBeenCalledWith(
      "changed",
      { epoch: "epoch-a", revision: 1 },
      { scope: "operator.read" },
    );
    expect(emit).toHaveBeenCalledWith(
      "changed",
      { epoch: "epoch-a", revision: 2 },
      { scope: "operator.read" },
    );
    expect(announceChangeEpoch).toHaveBeenCalledOnce();
    expect(reconcileExternalChanges).toHaveBeenCalledOnce();

    await service.stop?.(ctx);
    await vi.advanceTimersByTimeAsync(1000);
    expect(reconcileExternalChanges).toHaveBeenCalledOnce();
    expect(unsubscribe).toHaveBeenCalledOnce();
    vi.useRealTimers();
  });
});
