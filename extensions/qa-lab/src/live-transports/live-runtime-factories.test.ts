// Qa Lab tests cover canonical live transport adapter factory routing.
import { describe, expect, it, vi } from "vitest";
import { createQaBusState } from "../bus-state.js";
import { createQaTransportAdapterFactoryRegistry } from "../qa-transport-registry.js";

const { runQaSlackCommand, runQaTelegramCommand, runQaWhatsAppCommand } = vi.hoisted(() => ({
  runQaSlackCommand: vi.fn(async () => undefined),
  runQaTelegramCommand: vi.fn(async () => undefined),
  runQaWhatsAppCommand: vi.fn(async () => undefined),
}));

vi.mock("./slack/cli.runtime.js", () => ({ runQaSlackCommand }));
vi.mock("./telegram/cli.runtime.js", () => ({ runQaTelegramCommand }));
vi.mock("./whatsapp/cli.runtime.js", () => ({ runQaWhatsAppCommand }));

import { slackQaTransportFactory } from "./slack/cli.js";
import { telegramQaTransportFactory } from "./telegram/cli.js";
import { whatsappQaTransportFactory } from "./whatsapp/cli.js";

const factories = [
  telegramQaTransportFactory,
  slackQaTransportFactory,
  whatsappQaTransportFactory,
] as const;

describe("live transport adapter factories", () => {
  it.each([
    ["telegram", runQaTelegramCommand],
    ["slack", runQaSlackCommand],
    ["whatsapp", runQaWhatsAppCommand],
  ] as const)(
    "adapts the existing %s runtime through the canonical registry",
    async (channelId, run) => {
      const options = { scenarioIds: [`${channelId}-canary`] };
      const registry = createQaTransportAdapterFactoryRegistry(factories);
      const created = await registry.create({
        channelId,
        commandOptions: options,
        driver: "live",
        outputDir: ".artifacts/qa-e2e",
        state: createQaBusState(),
      });

      expect(created.adapter.kind).toBe("hosted");
      if (created.adapter.kind !== "hosted") {
        throw new Error("expected hosted live transport adapter");
      }
      await created.adapter.run();

      expect(run).toHaveBeenCalledWith(options);
    },
  );
});
