import type { OpenClawConfig } from "openclaw/plugin-sdk/config-contracts";
import { describe, expect, it } from "vitest";
import { legacyConfigRules, normalizeCompatibilityConfig } from "./doctor-contract-api.js";

describe("kimi doctor contract", () => {
  it("reports and migrates the shipped Anthropic-compatible provider defaults", () => {
    const original = {
      models: {
        providers: {
          kimi: {
            api: "anthropic-messages",
            baseUrl: "https://api.kimi.com/coding/",
            apiKey: "${KIMI_API_KEY}",
            headers: { "User-Agent": "custom-client" },
            models: [],
          },
        },
      },
    } satisfies OpenClawConfig;

    expect(legacyConfigRules[0]?.match(original.models.providers)).toBe(true);

    const result = normalizeCompatibilityConfig({ cfg: original });

    expect(result.changes).toEqual([
      "Migrated models.providers.kimi from OpenClaw's previous Kimi Coding Anthropic-compatible default to https://api.kimi.com/coding/v1.",
    ]);
    expect(result.config.models?.providers?.kimi).toEqual({
      api: "openai-completions",
      baseUrl: "https://api.kimi.com/coding/v1",
      apiKey: "${KIMI_API_KEY}",
      headers: { "User-Agent": "custom-client" },
      models: [],
    });
    expect(original.models.providers.kimi.api).toBe("anthropic-messages");
  });

  it("preserves custom endpoints and already-current configs", () => {
    const custom = {
      models: {
        providers: {
          kimi: {
            api: "anthropic-messages",
            baseUrl: "https://proxy.example.com/kimi",
            models: [],
          },
          "kimi-coding": {
            api: "openai-completions",
            baseUrl: "https://api.kimi.com/coding/v1",
            models: [],
          },
        },
      },
    } satisfies OpenClawConfig;

    const result = normalizeCompatibilityConfig({ cfg: custom });

    expect(result).toEqual({ config: custom, changes: [] });
  });

  it("migrates the shipped endpoint under legacy provider aliases and case variants", () => {
    const original = {
      models: {
        providers: {
          Kimi: {
            api: "anthropic-messages",
            baseUrl: "https://api.kimi.com/coding/",
            models: [],
          },
          "kimi-code": {
            api: "anthropic-messages",
            baseUrl: "https://api.kimi.com/coding",
            models: [],
          },
        },
      },
    } satisfies OpenClawConfig;

    const result = normalizeCompatibilityConfig({ cfg: original });

    expect(result.config.models?.providers?.Kimi).toMatchObject({
      api: "openai-completions",
      baseUrl: "https://api.kimi.com/coding/v1",
    });
    expect(result.config.models?.providers?.["kimi-code"]).toMatchObject({
      api: "openai-completions",
      baseUrl: "https://api.kimi.com/coding/v1",
    });
  });
});
