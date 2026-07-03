// Qa Lab plugin module implements cli behavior.
import {
  createLazyCliRuntimeLoader,
  createLiveTransportQaCliRegistration,
  type LiveTransportQaCliRegistration,
} from "../shared/live-transport-cli.js";

type WhatsAppQaCliRuntime = typeof import("./cli.runtime.js");

const loadWhatsAppQaCliRuntime = createLazyCliRuntimeLoader<WhatsAppQaCliRuntime>(
  () => import("./cli.runtime.js"),
);

export const whatsappQaTransportFactory: NonNullable<LiveTransportQaCliRegistration["factory"]> = {
  id: "whatsapp",
  matches: ({ channelId, driver }) => driver === "live" && channelId === "whatsapp",
  async create(context) {
    const options = context.commandOptions ?? {};
    const runtime = await loadWhatsAppQaCliRuntime();
    return {
      kind: "hosted",
      id: "whatsapp",
      run: async () => await runtime.runQaWhatsAppCommand(options),
    };
  },
};

export const whatsappQaCliRegistration: LiveTransportQaCliRegistration =
  createLiveTransportQaCliRegistration({
    commandName: "whatsapp",
    factory: whatsappQaTransportFactory,
    credentialOptions: {
      sourceDescription: "Credential source for WhatsApp QA: env or convex (default: env)",
      roleDescription:
        "Credential role for convex auth: maintainer or ci (default: ci in CI, maintainer otherwise)",
    },
    description: "Run the WhatsApp live QA lane against two pre-linked Web sessions",
    outputDirHelp: "WhatsApp QA artifact directory",
    scenarioHelp: "Run only the named WhatsApp QA scenario (repeatable)",
    sutAccountHelp: "Temporary WhatsApp account id inside the QA gateway config",
  });
