import { normalizeOptionalLowercaseString } from "@openclaw/normalization-core/string-coerce";

export function readToolResultDetails(result: unknown): Record<string, unknown> | undefined {
  if (!result || typeof result !== "object") {
    return undefined;
  }
  const record = result as Record<string, unknown>;
  return record.details && typeof record.details === "object" && !Array.isArray(record.details)
    ? (record.details as Record<string, unknown>)
    : undefined;
}

export function readToolResultStatus(result: unknown): string | undefined {
  return normalizeOptionalLowercaseString(readToolResultDetails(result)?.status);
}

export function isToolResultError(result: unknown): boolean {
  const details = readToolResultDetails(result);
  const normalized = readToolResultStatus(result);
  const explicitlySuccessful = details?.ok === true || details?.success === true;
  if (details?.ok === false || details?.success === false) {
    return true;
  }
  const hasFailureStatus =
    normalized === "error" ||
    normalized === "failed" ||
    normalized === "failure" ||
    normalized === "timeout" ||
    normalized === "timed_out" ||
    normalized === "blocked" ||
    normalized === "denied" ||
    normalized === "forbidden" ||
    normalized === "unavailable" ||
    normalized === "approval-unavailable" ||
    normalized === "disabled" ||
    normalized === "aborted" ||
    normalized === "cancelled" ||
    normalized === "canceled" ||
    normalized === "killed" ||
    normalized === "invalid";
  if (hasFailureStatus && !explicitlySuccessful) {
    return true;
  }
  if (details?.timedOut === true || Boolean(details?.error)) {
    return true;
  }
  const exitCode = details?.exitCode;
  return typeof exitCode === "number" && Number.isFinite(exitCode) && exitCode !== 0;
}

export type ToolResultFailureKind = "blocked" | "cancelled" | "failed" | "timed_out";

/** Classify a resolved structured tool result through the shared terminal contract. */
export function resolveToolResultFailureKind(result: unknown): ToolResultFailureKind | undefined {
  if (!isToolResultError(result)) {
    return undefined;
  }
  const status = readToolResultStatus(result);
  if (
    status === "blocked" ||
    status === "denied" ||
    status === "forbidden" ||
    status === "disabled" ||
    status === "approval-unavailable"
  ) {
    return "blocked";
  }
  const details = readToolResultDetails(result);
  if (details?.timedOut === true || status === "timeout" || status === "timed_out") {
    return "timed_out";
  }
  if (
    status === "aborted" ||
    status === "cancelled" ||
    status === "canceled" ||
    status === "killed"
  ) {
    return "cancelled";
  }
  return "failed";
}
