import { describe, expect, it } from "vitest";
import { withEnvOverride, withTempHomeConfig } from "../config/test-helpers.js";
import { shouldUseDirectLoopbackGatewayAuth } from "./direct-loopback-gateway-auth.js";

describe("shouldUseDirectLoopbackGatewayAuth", () => {
  it("recognizes literal configured gateway tokens as shared loopback auth", async () => {
    await withTempHomeConfig(
      {
        gateway: {
          auth: { mode: "token", token: "shared-token" },
        },
      },
      async () => {
        await withEnvOverride({ OPENCLAW_GATEWAY_TOKEN: undefined }, async () => {
          expect(
            shouldUseDirectLoopbackGatewayAuth({
              url: "ws://127.0.0.1:18789",
              token: "shared-token",
            }),
          ).toBe(true);
        });
      },
    );
  });

  it("keeps unconfigured loopback tokens on the device-token-capable path", async () => {
    await withTempHomeConfig(
      {
        gateway: {
          auth: { mode: "token", token: "shared-token" },
        },
      },
      async () => {
        await withEnvOverride({ OPENCLAW_GATEWAY_TOKEN: undefined }, async () => {
          expect(
            shouldUseDirectLoopbackGatewayAuth({
              url: "ws://127.0.0.1:18789",
              token: "operator-device-token",
            }),
          ).toBe(false);
        });
      },
    );
  });
});
