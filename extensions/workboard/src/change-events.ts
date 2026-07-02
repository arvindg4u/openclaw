// Workboard change events bridge canonical store mutations to the Gateway.
import type { OpenClawPluginApi } from "../api.js";
import type { WorkboardStore } from "./store.js";

const WORKBOARD_EXTERNAL_CHANGE_CHECK_MS = 1000;

type WorkboardService = Parameters<OpenClawPluginApi["registerService"]>[0];

export function createWorkboardChangeEventService(store: WorkboardStore): WorkboardService {
  let cleanup: (() => void) | undefined;
  return {
    id: "workboard-change-events",
    start: (ctx) => {
      cleanup?.();
      const gatewayEvents = ctx.gatewayEvents;
      if (!gatewayEvents) {
        cleanup = undefined;
        return;
      }
      const unsubscribe = store.subscribeChanges((change) => {
        gatewayEvents.emit("changed", change, { scope: "operator.read" });
      });
      // A new service/store lifetime can replace the previous epoch without a
      // websocket reconnect, so readers need one canonical reconciliation token.
      store.announceChangeEpoch();
      // Other CLI processes share this SQLite database. The cheap data-version
      // check reconciles their commits without restoring full-state UI polling.
      const timer = setInterval(() => {
        try {
          store.reconcileExternalChanges();
        } catch (error) {
          ctx.logger.warn(`workboard external change check failed: ${String(error)}`);
        }
      }, WORKBOARD_EXTERNAL_CHANGE_CHECK_MS);
      timer.unref?.();
      cleanup = () => {
        clearInterval(timer);
        unsubscribe();
      };
    },
    stop: () => {
      cleanup?.();
      cleanup = undefined;
    },
  };
}
