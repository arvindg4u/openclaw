// Qa Lab plugin module implements cli behavior.
import {
  createLazyCliRuntimeLoader,
  createLiveTransportQaCliRegistration,
  type LiveTransportQaCliRegistration,
} from "../shared/live-transport-cli.js";

type TelegramQaCliRuntime = typeof import("./cli.runtime.js");

const loadTelegramQaCliRuntime = createLazyCliRuntimeLoader<TelegramQaCliRuntime>(
  () => import("./cli.runtime.js"),
);

export const telegramQaTransportFactory: NonNullable<LiveTransportQaCliRegistration["factory"]> = {
  id: "telegram",
  matches: ({ channelId, driver }) => driver === "live" && channelId === "telegram",
  async create(context) {
    const options = context.commandOptions ?? {};
    const runtime = await loadTelegramQaCliRuntime();
    return {
      kind: "hosted",
      id: "telegram",
      run: async () => await runtime.runQaTelegramCommand(options),
    };
  },
};

export const telegramQaCliRegistration: LiveTransportQaCliRegistration =
  createLiveTransportQaCliRegistration({
    commandName: "telegram",
    factory: telegramQaTransportFactory,
    credentialOptions: {
      sourceDescription: "Credential source for Telegram QA: env or convex (default: env)",
      roleDescription:
        "Credential role for convex auth: maintainer or ci (default: ci in CI, maintainer otherwise)",
    },
    description: "Run the manual Telegram live QA lane against a private bot-to-bot group harness",
    listScenariosHelp: "Print available Telegram scenario ids and exit",
    outputDirHelp: "Telegram QA artifact directory",
    scenarioHelp: "Run only the named Telegram QA scenario (repeatable)",
    sutAccountHelp: "Temporary Telegram account id inside the QA gateway config",
  });
