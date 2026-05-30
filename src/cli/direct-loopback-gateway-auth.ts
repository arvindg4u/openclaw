import { loadConfig } from "../config/io.js";
import type { OpenClawConfig } from "../config/types.openclaw.js";
import { resolveGatewayAuth } from "../gateway/auth.js";
import { buildGatewayConnectionDetails } from "../gateway/call.js";
import { isLoopbackHost } from "../gateway/net.js";
import { normalizeStringifiedOptionalString } from "../shared/string-coerce.js";

export type DirectLoopbackGatewayAuthOpts = {
  url?: string;
  token?: string;
  password?: string;
  config?: OpenClawConfig;
};

function isConfiguredSharedGatewayToken(params: {
  token: string | undefined;
  config?: OpenClawConfig;
}): boolean {
  if (!params.token) {
    return false;
  }
  const config = params.config ?? loadConfigForDirectAuthProbe();
  const auth = resolveGatewayAuth({
    authConfig: config?.gateway?.auth,
    tailscaleMode: config?.gateway?.tailscale?.mode,
    env: process.env,
  });
  return auth.mode === "token" && auth.token === params.token;
}

function loadConfigForDirectAuthProbe(): OpenClawConfig | undefined {
  try {
    return loadConfig({ skipPluginValidation: true, pin: false });
  } catch {
    return undefined;
  }
}

export function shouldUseDirectLoopbackGatewayAuth(opts: DirectLoopbackGatewayAuthOpts): boolean {
  const token = normalizeStringifiedOptionalString(opts.token);
  const password = normalizeStringifiedOptionalString(opts.password);
  const hasExplicitSharedAuth = Boolean(
    password || isConfiguredSharedGatewayToken({ token, config: opts.config }),
  );
  if (!hasExplicitSharedAuth) {
    return false;
  }
  const explicitUrl = normalizeStringifiedOptionalString(opts.url);
  const gatewayUrl = explicitUrl ?? buildGatewayConnectionDetails({ config: opts.config }).url;
  try {
    return isLoopbackHost(new URL(gatewayUrl).hostname);
  } catch {
    return false;
  }
}
