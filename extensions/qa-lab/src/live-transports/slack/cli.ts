// Qa Lab plugin module implements cli behavior.
import {
  createLazyCliRuntimeLoader,
  createLiveTransportQaCliRegistration,
  type LiveTransportQaCliRegistration,
} from "../shared/live-transport-cli.js";

type SlackQaCliRuntime = typeof import("./cli.runtime.js");

const loadSlackQaCliRuntime = createLazyCliRuntimeLoader<SlackQaCliRuntime>(
  () => import("./cli.runtime.js"),
);

export const slackQaTransportFactory: NonNullable<LiveTransportQaCliRegistration["factory"]> = {
  id: "slack",
  matches: ({ channelId, driver }) => driver === "live" && channelId === "slack",
  async create(context) {
    const options = context.commandOptions ?? {};
    const runtime = await loadSlackQaCliRuntime();
    return {
      kind: "hosted",
      id: "slack",
      run: async () => await runtime.runQaSlackCommand(options),
    };
  },
};

export const slackQaCliRegistration: LiveTransportQaCliRegistration =
  createLiveTransportQaCliRegistration({
    commandName: "slack",
    factory: slackQaTransportFactory,
    credentialOptions: {
      sourceDescription: "Credential source for Slack QA: env or convex (default: env)",
      roleDescription:
        "Credential role for convex auth: maintainer or ci (default: ci in CI, maintainer otherwise)",
    },
    description: "Run the Slack live QA lane against a private bot-to-bot channel harness",
    outputDirHelp: "Slack QA artifact directory",
    scenarioHelp: "Run only the named Slack QA scenario (repeatable)",
    sutAccountHelp: "Temporary Slack account id inside the QA gateway config",
  });
