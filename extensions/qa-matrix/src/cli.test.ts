// Qa Matrix tests cover cli plugin behavior.
import { Command } from "commander";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { runQaMatrixCommand } = vi.hoisted(() => ({
  runQaMatrixCommand: vi.fn(),
}));

vi.mock("./cli.runtime.js", () => ({
  runQaMatrixCommand,
}));

import { matrixQaCliRegistration, matrixQaTransportFactory } from "./cli.js";

function mockProcessWrite(
  _chunk: string | Uint8Array,
  encodingOrCallback?: BufferEncoding | ((err?: Error | null) => void),
  callback?: (err?: Error | null) => void,
) {
  if (typeof encodingOrCallback === "function") {
    encodingOrCallback();
  } else {
    callback?.();
  }
  return true;
}

describe("matrix qa cli registration", () => {
  const originalDisableForceExit = process.env.OPENCLAW_QA_MATRIX_DISABLE_FORCE_EXIT;
  let exitSpy: ReturnType<typeof vi.spyOn>;
  let stderrSpy: ReturnType<typeof vi.spyOn>;
  let stdoutSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    runQaMatrixCommand.mockReset();
    exitSpy = vi.spyOn(process, "exit").mockImplementation((code?: string | number | null) => {
      throw new Error(`process.exit(${String(code)})`);
    });
    stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(mockProcessWrite);
    stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation(mockProcessWrite);
  });

  afterEach(() => {
    if (originalDisableForceExit === undefined) {
      delete process.env.OPENCLAW_QA_MATRIX_DISABLE_FORCE_EXIT;
    } else {
      process.env.OPENCLAW_QA_MATRIX_DISABLE_FORCE_EXIT = originalDisableForceExit;
    }
    exitSpy.mockRestore();
    stderrSpy.mockRestore();
    stdoutSpy.mockRestore();
  });

  it("keeps disposable Matrix lane flags focused", () => {
    const qa = new Command();

    matrixQaCliRegistration.register(qa, vi.fn());

    const matrix = qa.commands.find((command) => command.name() === "matrix");
    const optionNames = matrix?.options.map((option) => option.long) ?? [];

    for (const optionName of [
      "--repo-root",
      "--output-dir",
      "--provider-mode",
      "--model",
      "--alt-model",
      "--scenario",
      "--fast",
      "--profile",
      "--fail-fast",
      "--sut-account",
    ]) {
      expect(optionNames).toContain(optionName);
    }
    expect(optionNames).not.toContain("--credential-source");
    expect(optionNames).not.toContain("--credential-role");
  });

  it("exits with failure after Matrix artifacts are written for a failed run", async () => {
    const qa = new Command();
    const runHosted = vi
      .fn()
      .mockRejectedValue(new Error("Matrix QA failed.\nreport: /tmp/report.md"));
    matrixQaCliRegistration.register(qa, runHosted);

    await expect(qa.parseAsync(["node", "openclaw", "matrix"])).rejects.toThrow("process.exit(1)");

    expect(runHosted).toHaveBeenCalledOnce();
    expect(stderrSpy).toHaveBeenCalledWith("Matrix QA failed.\nreport: /tmp/report.md\n");
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it("can disable the forced exit for direct test harnesses", async () => {
    process.env.OPENCLAW_QA_MATRIX_DISABLE_FORCE_EXIT = "1";
    const qa = new Command();
    const runHosted = vi.fn().mockRejectedValue(new Error("scenario failed"));
    matrixQaCliRegistration.register(qa, runHosted);

    await expect(qa.parseAsync(["node", "openclaw", "matrix"])).rejects.toThrow("scenario failed");

    expect(exitSpy).not.toHaveBeenCalled();
  });

  it("adapts the Matrix runtime through its contributed factory", async () => {
    const options = { scenarioIds: ["matrix-canary"] };
    const adapter = await matrixQaTransportFactory.create({
      channelId: "matrix",
      commandOptions: options,
      driver: "live",
      outputDir: ".artifacts/qa-e2e",
      state: undefined,
    });

    await adapter.run();

    expect(runQaMatrixCommand).toHaveBeenCalledWith(options);
  });
});
