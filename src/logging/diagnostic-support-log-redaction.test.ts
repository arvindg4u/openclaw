import { describe, expect, it } from "vitest";
import { sanitizeSupportLogRecord } from "./diagnostic-support-log-redaction.js";

const redaction = { env: {}, stateDir: "/tmp/openclaw-state" };

describe("sanitizeSupportLogRecord", () => {
  it("preserves invalid and non-object classification", () => {
    expect(sanitizeSupportLogRecord("{", redaction)).toEqual({ omitted: "unparsed", bytes: 1 });
    expect(sanitizeSupportLogRecord("[]", redaction)).toEqual({
      omitted: "non-object",
      bytes: 2,
    });
  });

  it("reads structured LogTape fields from JSON strings", () => {
    expect(
      sanitizeSupportLogRecord(
        '{"_meta":{"name":"{\\"component\\":\\"gateway\\"}"},"0":"{\\"status\\":\\"ok\\"}"}',
        redaction,
      ),
    ).toMatchObject({ component: "gateway", status: "ok" });
  });
});
