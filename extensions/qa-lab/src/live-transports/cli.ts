// Qa Lab plugin module implements cli behavior.
import { listQaRunnerCliContributions } from "openclaw/plugin-sdk/qa-runner-runtime";
import { runQaHostedTransportSuite } from "../suite-launch.runtime.js";
import { discordQaCliRegistration } from "./discord/cli.js";
import type { LiveTransportQaCliRegistration } from "./shared/live-transport-cli.js";
import { slackQaCliRegistration } from "./slack/cli.js";
import { slackQaTransportFactory } from "./slack/cli.js";
import { telegramQaCliRegistration } from "./telegram/cli.js";
import { telegramQaTransportFactory } from "./telegram/cli.js";
import { whatsappQaCliRegistration, whatsappQaTransportFactory } from "./whatsapp/cli.js";

function createBlockedQaRunnerCliRegistration(params: {
  commandName: string;
  description?: string;
  pluginId: string;
}): LiveTransportQaCliRegistration {
  return {
    commandName: params.commandName,
    register(qa) {
      qa.command(params.commandName)
        .description(params.description ?? `Run the ${params.commandName} live QA lane`)
        .action(() => {
          throw new Error(
            `QA runner "${params.commandName}" is installed but not active. Enable or allow plugin "${params.pluginId}" in your OpenClaw config, then try again.`,
          );
        });
    },
  };
}

function createQaRunnerCliRegistration(
  runner: ReturnType<typeof listQaRunnerCliContributions>[number],
): LiveTransportQaCliRegistration {
  if (runner.status === "available") {
    const factory = runner.registration.factory;
    if (!factory) {
      return runner.registration;
    }
    return {
      commandName: runner.commandName,
      register(qa) {
        runner.registration.register(qa, async (options) => {
          await runQaHostedTransportSuite(runner.commandName, options, [factory]);
        });
      },
    };
  }
  return createBlockedQaRunnerCliRegistration({
    commandName: runner.commandName,
    description: runner.description,
    pluginId: runner.pluginId,
  });
}

const BUILT_IN_LIVE_TRANSPORT_FACTORIES = [
  telegramQaTransportFactory,
  slackQaTransportFactory,
  whatsappQaTransportFactory,
] as const;

const LIVE_TRANSPORT_QA_CLI_REGISTRATIONS: readonly LiveTransportQaCliRegistration[] = [
  registerBuiltInLiveTransportQaCli(telegramQaCliRegistration),
  discordQaCliRegistration,
  registerBuiltInLiveTransportQaCli(slackQaCliRegistration),
  registerBuiltInLiveTransportQaCli(whatsappQaCliRegistration),
];

export function listLiveTransportQaCliRegistrations(): readonly LiveTransportQaCliRegistration[] {
  const liveRegistrations = [...LIVE_TRANSPORT_QA_CLI_REGISTRATIONS];
  const discoveredRunners = listQaRunnerCliContributions();

  for (const runner of discoveredRunners) {
    liveRegistrations.push(createQaRunnerCliRegistration(runner));
  }

  return liveRegistrations;
}

function registerBuiltInLiveTransportQaCli(
  registration: LiveTransportQaCliRegistration,
): LiveTransportQaCliRegistration {
  return {
    commandName: registration.commandName,
    register(qa) {
      registration.register(qa, async (options) => {
        await runQaHostedTransportSuite(
          registration.commandName,
          options,
          BUILT_IN_LIVE_TRANSPORT_FACTORIES,
        );
      });
    },
  };
}
