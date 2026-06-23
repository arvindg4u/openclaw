// Gmail watcher lifecycle tests cover start, stop, and restart behavior.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { startGmailWatcherMock } = vi.hoisted(() => ({
  startGmailWatcherMock: vi.fn(),
}));

vi.mock("./gmail-watcher.js", () => ({
  startGmailWatcher: startGmailWatcherMock,
}));

import { startGmailWatcherWithLogs } from "./gmail-watcher-lifecycle.js";

describe("startGmailWatcherWithLogs", () => {
  const log = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };

  beforeEach(() => {
    startGmailWatcherMock.mockClear();
    log.info.mockClear();
    log.warn.mockClear();
    log.error.mockClear();
    delete process.env.OPENCLAW_SKIP_GMAIL_WATCHER;
  });

  afterEach(() => {
    delete process.env.OPENCLAW_SKIP_GMAIL_WATCHER;
  });

  it("passes cancellation state to watcher startup", async () => {
    const isCancelled = vi.fn(() => true);
    const abortController = new AbortController();
    startGmailWatcherMock.mockResolvedValue({ started: false, reason: "startup cancelled" });

    const outcome = await startGmailWatcherWithLogs({
      cfg: {},
      log,
      isCancelled,
      signal: abortController.signal,
    });

    expect(startGmailWatcherMock).toHaveBeenCalledWith(
      {},
      { isCancelled, signal: abortController.signal },
    );
    expect(outcome).toEqual({
      sidecar: "gmail-watch",
      status: "skipped",
      reason: "startup-cancelled",
    });
  });

  it("logs startup success", async () => {
    startGmailWatcherMock.mockResolvedValue({ started: true, reason: undefined });

    const outcome = await startGmailWatcherWithLogs({
      cfg: {},
      log,
    });

    expect(log.info).toHaveBeenCalledWith("gmail watcher started");
    expect(log.warn).not.toHaveBeenCalled();
    expect(log.error).not.toHaveBeenCalled();
    expect(outcome).toEqual({ sidecar: "gmail-watch", status: "started" });
  });

  it("logs redacted startup failure reason", async () => {
    startGmailWatcherMock.mockResolvedValue({ started: false, reason: "auth failed" });

    const outcome = await startGmailWatcherWithLogs({
      cfg: {},
      log,
    });

    expect(log.warn).toHaveBeenCalledWith("gmail watcher not started: startup failed");
    expect(outcome).toEqual({ sidecar: "gmail-watch", status: "failed" });
  });

  it("suppresses expected non-start reasons", async () => {
    startGmailWatcherMock.mockResolvedValue({
      started: false,
      reason: "hooks not enabled",
    });

    const outcome = await startGmailWatcherWithLogs({
      cfg: {},
      log,
    });

    expect(log.warn).not.toHaveBeenCalled();
    expect(outcome).toEqual({
      sidecar: "gmail-watch",
      status: "skipped",
      reason: "hooks-not-enabled",
    });
  });

  it("returns missing-account startup outcome without warning", async () => {
    startGmailWatcherMock.mockResolvedValue({
      started: false,
      reason: "no gmail account configured",
    });

    const outcome = await startGmailWatcherWithLogs({
      cfg: {},
      log,
    });

    expect(log.warn).not.toHaveBeenCalled();
    expect(outcome).toEqual({
      sidecar: "gmail-watch",
      status: "skipped",
      reason: "missing-account",
    });
  });

  it("supports skip callback when watcher is disabled", async () => {
    process.env.OPENCLAW_SKIP_GMAIL_WATCHER = "1";
    const onSkipped = vi.fn();

    const outcome = await startGmailWatcherWithLogs({
      cfg: {},
      log,
      onSkipped,
    });

    expect(startGmailWatcherMock).not.toHaveBeenCalled();
    expect(onSkipped).toHaveBeenCalledTimes(1);
    expect(outcome).toEqual({
      sidecar: "gmail-watch",
      status: "skipped",
      reason: "disabled-by-env",
    });
  });

  it("logs startup errors", async () => {
    startGmailWatcherMock.mockRejectedValue(new Error("boom"));

    const outcome = await startGmailWatcherWithLogs({
      cfg: {},
      log,
    });

    expect(log.error).toHaveBeenCalledWith("gmail watcher failed to start");
    expect(outcome).toEqual({ sidecar: "gmail-watch", status: "failed" });
  });
});
