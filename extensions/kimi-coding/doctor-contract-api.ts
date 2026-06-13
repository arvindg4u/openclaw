import type { OpenClawConfig } from "openclaw/plugin-sdk/config-contracts";
import { normalizeProviderId } from "openclaw/plugin-sdk/provider-model-shared";

type LegacyConfigRule = {
  path: string[];
  message: string;
  match: (value: unknown) => boolean;
};

const KIMI_PROVIDER_IDS = ["kimi", "kimi-code", "kimi-coding"] as const;
const LEGACY_API = "anthropic-messages";
const LEGACY_BASE_URL = "https://api.kimi.com/coding";
const CURRENT_API = "openai-completions";
const CURRENT_BASE_URL = "https://api.kimi.com/coding/v1";

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function normalizeBaseUrl(value: unknown): string {
  return typeof value === "string" ? value.trim().replace(/\/+$/, "") : "";
}

function isLegacyKimiProvider(value: unknown): boolean {
  const provider = asRecord(value);
  return provider?.api === LEGACY_API && normalizeBaseUrl(provider.baseUrl) === LEGACY_BASE_URL;
}

const KIMI_PROVIDER_ID_SET = new Set<string>(KIMI_PROVIDER_IDS);

function isKimiProviderId(providerId: string): boolean {
  return KIMI_PROVIDER_ID_SET.has(normalizeProviderId(providerId));
}

function hasLegacyKimiProvider(value: unknown): boolean {
  const providers = asRecord(value);
  return Boolean(
    providers &&
    Object.entries(providers).some(
      ([providerId, provider]) => isKimiProviderId(providerId) && isLegacyKimiProvider(provider),
    ),
  );
}

export const legacyConfigRules: LegacyConfigRule[] = [
  {
    path: ["models", "providers"],
    message:
      'A configured Kimi provider uses OpenClaw\'s previous Anthropic-compatible default; run "openclaw doctor --fix" to migrate it to the OpenAI-compatible endpoint.',
    match: hasLegacyKimiProvider,
  },
];

export function normalizeCompatibilityConfig({ cfg }: { cfg: OpenClawConfig }): {
  config: OpenClawConfig;
  changes: string[];
} {
  const providers = asRecord(cfg.models?.providers);
  if (!providers) {
    return { config: cfg, changes: [] };
  }

  const legacyProviders = Object.entries(providers).filter(
    ([providerId, provider]) => isKimiProviderId(providerId) && isLegacyKimiProvider(provider),
  );
  if (legacyProviders.length === 0) {
    return { config: cfg, changes: [] };
  }

  const nextConfig = structuredClone(cfg);
  const nextProviders = asRecord(nextConfig.models?.providers);
  if (!nextProviders) {
    return { config: cfg, changes: [] };
  }

  const changes: string[] = [];
  for (const [providerId] of legacyProviders) {
    const provider = asRecord(nextProviders[providerId]);
    if (!provider) {
      continue;
    }
    provider.api = CURRENT_API;
    provider.baseUrl = CURRENT_BASE_URL;
    changes.push(
      `Migrated models.providers.${providerId} from OpenClaw's previous Kimi Coding Anthropic-compatible default to ${CURRENT_BASE_URL}.`,
    );
  }
  return { config: nextConfig, changes };
}
