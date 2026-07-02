/** Starts, stops, and inspects plugin service registrations. */
import { STATE_DIR } from "../config/paths.js";
import type { OpenClawConfig } from "../config/types.openclaw.js";
import {
  emitTrustedDiagnosticEventWithPrivateData,
  onTrustedInternalDiagnosticEvent,
} from "../infra/diagnostic-events.js";
import { createSubsystemLogger } from "../logging/subsystem.js";
import { withPluginHttpRouteRegistry } from "./http-registry.js";
import type { PluginServiceRegistration } from "./registry-types.js";
import type { PluginRegistry } from "./registry.js";
import { encodeStartupTraceSegment } from "./startup-trace-segment.js";
import type { OpenClawPluginServiceContext, PluginLogger } from "./types.js";

type PluginGatewayEventScope = Parameters<
  NonNullable<OpenClawPluginServiceContext["gatewayEvents"]>["emit"]
>[2]["scope"];

type PluginGatewayEventBroadcast = (
  event: string,
  payload: unknown,
  scope: PluginGatewayEventScope,
) => void;

const PLUGIN_GATEWAY_EVENT_NAME_PATTERN = /^[a-z0-9](?:[a-z0-9._-]*[a-z0-9])?$/;
const PLUGIN_GATEWAY_EVENT_SCOPES = new Set<PluginGatewayEventScope>([
  "operator.read",
  "operator.write",
  "operator.admin",
]);

const log = createSubsystemLogger("plugins");
function createPluginLogger(): PluginLogger {
  return {
    info: (msg) => log.info(msg),
    warn: (msg) => log.warn(msg),
    error: (msg) => log.error(msg),
    debug: (msg) => log.debug(msg),
  };
}

function createServiceContext(params: {
  config: OpenClawConfig;
  startupTrace?: PluginServiceStartupTrace;
  workspaceDir?: string;
  service: PluginServiceRegistration;
  gatewayEventBroadcast?: PluginGatewayEventBroadcast;
}): { context: OpenClawPluginServiceContext; revoke: () => void } {
  let active = true;
  const isDiagnosticsExporter =
    params.service?.pluginId === params.service?.service.id &&
    (params.service?.service.id === "diagnostics-otel" ||
      params.service?.service.id === "diagnostics-prometheus");
  const grantsInternalDiagnostics =
    isDiagnosticsExporter &&
    (params.service?.origin === "bundled" || params.service?.trustedOfficialInstall === true);

  const context: OpenClawPluginServiceContext = {
    config: params.config,
    workspaceDir: params.workspaceDir,
    stateDir: STATE_DIR,
    logger: createPluginLogger(),
    ...(params.startupTrace
      ? {
          startupTrace: createScopedPluginServiceStartupTrace(
            params.startupTrace,
            createPluginServiceTraceName(params.service),
          ),
        }
      : {}),
    ...(grantsInternalDiagnostics
      ? {
          internalDiagnostics: {
            emit: emitTrustedDiagnosticEventWithPrivateData,
            onEvent: onTrustedInternalDiagnosticEvent,
          },
        }
      : {}),
    ...(params.gatewayEventBroadcast
      ? {
          gatewayEvents: {
            emit: (event, payload, opts) => {
              if (!active) {
                throw new Error("plugin gateway event emitter is inactive");
              }
              const normalizedEvent = event.trim();
              if (
                !PLUGIN_GATEWAY_EVENT_NAME_PATTERN.test(normalizedEvent) ||
                normalizedEvent.includes("..")
              ) {
                throw new Error(`invalid plugin gateway event name: ${event}`);
              }
              const scope: unknown = opts?.scope;
              if (!PLUGIN_GATEWAY_EVENT_SCOPES.has(scope as PluginGatewayEventScope)) {
                throw new Error(`invalid plugin gateway event scope: ${String(scope)}`);
              }
              params.gatewayEventBroadcast?.(
                `plugin.${params.service.pluginId}.${normalizedEvent}`,
                payload,
                scope as PluginGatewayEventScope,
              );
            },
          },
        }
      : {}),
  };
  return {
    context,
    revoke: () => {
      active = false;
    },
  };
}

function createPluginServiceTraceName(entry: PluginServiceRegistration): string {
  return `sidecars.plugin-services.${encodeStartupTraceSegment(entry.pluginId)}.${encodeStartupTraceSegment(entry.service.id)}`;
}

function createScopedPluginServiceStartupTrace(
  startupTrace: PluginServiceStartupTrace,
  prefix: string,
): PluginServiceStartupTrace {
  const scopeName = (name: string) =>
    `${prefix}.${name
      .split(".")
      .map((segment) => encodeStartupTraceSegment(segment))
      .join(".")}`;
  return {
    measure: (name, run) => startupTrace.measure(scopeName(name), run),
    ...(startupTrace.detail
      ? {
          detail: (name, metrics) => startupTrace.detail?.(scopeName(name), metrics),
        }
      : {}),
  };
}

export type PluginServicesHandle = {
  stop: () => Promise<void>;
};

type PluginServiceStartupTrace = {
  detail?: (name: string, metrics: ReadonlyArray<readonly [string, number | string]>) => void;
  measure: <T>(name: string, run: () => T | Promise<T>) => Promise<T>;
};

export async function startPluginServices(params: {
  registry: PluginRegistry;
  config: OpenClawConfig;
  workspaceDir?: string;
  startupTrace?: PluginServiceStartupTrace;
  gatewayEventBroadcast?: PluginGatewayEventBroadcast;
}): Promise<PluginServicesHandle> {
  const running: Array<{
    id: string;
    revoke: () => void;
    stop?: () => void | Promise<void>;
  }> = [];
  let failedCount = 0;
  for (const entry of params.registry.services) {
    const service = entry.service;
    const traceName = createPluginServiceTraceName(entry);
    const serviceContextHandle = createServiceContext({
      config: params.config,
      startupTrace: params.startupTrace,
      workspaceDir: params.workspaceDir,
      service: entry,
      gatewayEventBroadcast: params.gatewayEventBroadcast,
    });
    const serviceContext = serviceContextHandle.context;
    try {
      const startService = () =>
        withPluginHttpRouteRegistry(params.registry, () => service.start(serviceContext));
      if (params.startupTrace) {
        await params.startupTrace.measure(traceName, startService);
      } else {
        await startService();
      }
      running.push({
        id: service.id,
        revoke: serviceContextHandle.revoke,
        stop: service.stop ? () => service.stop?.(serviceContext) : undefined,
      });
    } catch (err) {
      serviceContextHandle.revoke();
      failedCount += 1;
      const error = err as Error;
      log.error(
        `plugin service failed (${service.id}, plugin=${entry.pluginId}, root=${entry.rootDir ?? "unknown"}): ${error?.message ?? String(err)}`,
      );
    }
  }
  params.startupTrace?.detail?.("sidecars.plugin-services.summary", [
    ["serviceCount", params.registry.services.length],
    ["startedCount", running.length],
    ["failedCount", failedCount],
  ]);

  return {
    stop: async () => {
      for (const entry of running.toReversed()) {
        if (!entry.stop) {
          entry.revoke();
          continue;
        }
        try {
          await withPluginHttpRouteRegistry(params.registry, () => entry.stop?.());
        } catch (err) {
          log.warn(`plugin service stop failed (${entry.id}): ${String(err)}`);
        } finally {
          // The service context remains valid during its own cleanup, then is
          // revoked even when cleanup fails so old callbacks cannot outlive it.
          entry.revoke();
        }
      }
    },
  };
}
