import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { OpenClawConfig } from "../config/types.openclaw.js";

const repoRoot = fileURLToPath(new URL("../..", import.meta.url));
const manifestContractEligibilityMocks = vi.hoisted(() => ({
  loadManifestMetadataSnapshot: vi.fn(),
}));

vi.mock("./manifest-contract-eligibility.js", () => ({
  loadManifestMetadataSnapshot: manifestContractEligibilityMocks.loadManifestMetadataSnapshot,
}));

let hasConfiguredWebSearchCredential: typeof import("./web-search-credential-presence.js").hasConfiguredWebSearchCredential;

beforeAll(async () => {
  ({ hasConfiguredWebSearchCredential } = await import("./web-search-credential-presence.js"));
});

function setManifestPlugins(plugins: Array<Record<string, unknown>>) {
  manifestContractEligibilityMocks.loadManifestMetadataSnapshot.mockReturnValue({ plugins });
}

function createPoisonedManifestPlugin(
  id: string,
  field: "contracts" | "setup" | "providerAuthEnvVars",
): Record<string, unknown> {
  const plugin: Record<string, unknown> = {
    id,
    origin: "bundled",
    contracts: { webSearchProviders: [`${id}-search`] },
    setup: {
      providers: [{ id, envVars: [`${id.toUpperCase().replaceAll("-", "_")}_API_KEY`] }],
    },
    providerAuthEnvVars: {},
  };
  Object.defineProperty(plugin, field, {
    get() {
      throw new Error(`web search credential ${field} metadata exploded`);
    },
  });
  return plugin;
}

describe("hasConfiguredWebSearchCredential", () => {
  beforeEach(() => {
    manifestContractEligibilityMocks.loadManifestMetadataSnapshot.mockReset();
    setManifestPlugins([]);
  });

  it("does not statically import web-search runtime providers", () => {
    const source = fs.readFileSync(
      path.join(repoRoot, "src/plugins/web-search-credential-presence.ts"),
      "utf8",
    );

    expect(source).not.toMatch(/\bfrom\s+["'][^"']*web-search-providers\.runtime\.js["']/);
    expect(source).not.toMatch(/\bfrom\s+["'][^"']*loader\.js["']/);
  });

  it("keeps empty config and env on the manifest-only path", () => {
    expect(
      hasConfiguredWebSearchCredential({
        config: {} as OpenClawConfig,
        env: {},
        origin: "bundled",
      }),
    ).toBe(false);
  });

  it("detects configured web search credential candidates without runtime loading", () => {
    expect(
      hasConfiguredWebSearchCredential({
        config: {
          tools: { web: { search: { apiKey: "brave-key" } } },
        } as OpenClawConfig,
        env: {},
        origin: "bundled",
      }),
    ).toBe(true);
  });

  it("skips unreadable manifest credential metadata while detecting env credentials", () => {
    setManifestPlugins([
      createPoisonedManifestPlugin("bad-contracts", "contracts"),
      createPoisonedManifestPlugin("bad-setup", "setup"),
      createPoisonedManifestPlugin("bad-provider-env", "providerAuthEnvVars"),
      {
        id: "brave",
        origin: "bundled",
        contracts: { webSearchProviders: ["brave"] },
        setup: {
          providers: [{ id: "brave", envVars: ["BRAVE_API_KEY"] }],
        },
        providerAuthEnvVars: {},
      },
    ]);

    expect(
      hasConfiguredWebSearchCredential({
        config: {} as OpenClawConfig,
        env: { BRAVE_API_KEY: "brave-key" },
        origin: "bundled",
      }),
    ).toBe(true);
  });
});
