import { describe, expect, it, vi } from "vitest";

import type { OpenClawConfig } from "../../config/types.openclaw.js";
import {
  buildPluginRuntimeLoadOptionsWithEffect,
  resolvePluginRuntimeLoadContextWithEffect,
} from "./load-context-effect.js";

function createLogger() {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  };
}

describe("plugin runtime Effect load context", () => {
  it("resolves runtime load context through an Effect layer", () => {
    const config = { plugins: { enabled: true } } as OpenClawConfig;
    const env = { OPENCLAW_TEST: "1" };
    const logger = createLogger();

    const context = resolvePluginRuntimeLoadContextWithEffect({
      config,
      env,
      logger,
      workspaceDir: "/tmp/openclaw-agent",
    });

    expect(context.rawConfig).toBe(config);
    expect(context.env).toBe(env);
    expect(context.logger).toBe(logger);
    expect(context.workspaceDir).toBe("/tmp/openclaw-agent");
  });

  it("builds load options from an existing context through Effect", () => {
    const config = { plugins: { enabled: true } } as OpenClawConfig;
    const context = resolvePluginRuntimeLoadContextWithEffect({
      config,
      env: {},
      logger: createLogger(),
      workspaceDir: "/tmp/openclaw-agent",
    });

    const options = buildPluginRuntimeLoadOptionsWithEffect(context, {
      onlyPluginIds: ["demo"],
      cache: false,
      activate: false,
    });

    expect(options.config).toBe(context.config);
    expect(options.workspaceDir).toBe("/tmp/openclaw-agent");
    expect(options.onlyPluginIds).toEqual(["demo"]);
    expect(options.cache).toBe(false);
    expect(options.activate).toBe(false);
  });
});
