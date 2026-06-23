// Gmail watcher lifecycle helpers manage watcher process state from config.
import type { OpenClawConfig } from "../config/types.openclaw.js";
import { isTruthyEnvValue } from "../infra/env.js";
import { startGmailWatcher } from "./gmail-watcher.js";

/** Logging surface used while starting the Gmail watcher during gateway startup. */
export type GMailWatcherLog = {
  info: (msg: string) => void;
  warn: (msg: string) => void;
  error: (msg: string) => void;
};

export type GMailWatcherStartupOutcome =
  | { sidecar: "gmail-watch"; status: "started" }
  | {
      sidecar: "gmail-watch";
      status: "skipped";
      reason: "disabled-by-env" | "hooks-not-enabled" | "missing-account" | "startup-cancelled";
    }
  | { sidecar: "gmail-watch"; status: "failed" };

function classifyGmailWatcherStartupResult(params: {
  started: boolean;
  reason?: string;
}): GMailWatcherStartupOutcome {
  if (params.started) {
    return { sidecar: "gmail-watch", status: "started" };
  }
  if (params.reason === "hooks not enabled") {
    return { sidecar: "gmail-watch", status: "skipped", reason: "hooks-not-enabled" };
  }
  if (params.reason === "no gmail account configured") {
    return { sidecar: "gmail-watch", status: "skipped", reason: "missing-account" };
  }
  if (params.reason === "startup cancelled") {
    return { sidecar: "gmail-watch", status: "skipped", reason: "startup-cancelled" };
  }
  return { sidecar: "gmail-watch", status: "failed" };
}

/** Start the Gmail watcher with startup logs and env-based skip handling. */
export async function startGmailWatcherWithLogs(params: {
  cfg: OpenClawConfig;
  log: GMailWatcherLog;
  onSkipped?: () => void;
  isCancelled?: () => boolean;
  signal?: AbortSignal;
}): Promise<GMailWatcherStartupOutcome> {
  if (isTruthyEnvValue(process.env.OPENCLAW_SKIP_GMAIL_WATCHER)) {
    // Test and local recovery paths use the env skip to avoid starting a long
    // lived watcher while still exercising gateway startup.
    params.onSkipped?.();
    return { sidecar: "gmail-watch", status: "skipped", reason: "disabled-by-env" };
  }

  try {
    const gmailResult = await startGmailWatcher(params.cfg, {
      isCancelled: params.isCancelled,
      signal: params.signal,
    });
    const outcome = classifyGmailWatcherStartupResult(gmailResult);
    if (gmailResult.started) {
      params.log.info("gmail watcher started");
      return outcome;
    }
    if (
      gmailResult.reason &&
      gmailResult.reason !== "hooks not enabled" &&
      gmailResult.reason !== "no gmail account configured"
    ) {
      params.log.warn("gmail watcher not started: startup failed");
    }
    return outcome;
  } catch (err) {
    params.log.error("gmail watcher failed to start");
    return { sidecar: "gmail-watch", status: "failed" };
  }
}
