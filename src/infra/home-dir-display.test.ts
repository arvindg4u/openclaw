import path from "node:path";
import { describe, expect, it } from "vitest";
import { withEnv } from "../test-utils/env.js";
import {
  displayPath,
  displayString,
  resolveHomeDir,
  shortenHomeInString,
  shortenHomePath,
} from "./home-dir-display.js";

describe("resolveHomeDir", () => {
  it("prefers OPENCLAW_HOME over HOME", () => {
    withEnv({ OPENCLAW_HOME: "/srv/openclaw-home", HOME: "/home/other" }, () => {
      expect(resolveHomeDir()).toBe(path.resolve("/srv/openclaw-home"));
    });
  });
});

describe("home path presentation", () => {
  it("uses $OPENCLAW_HOME for paths and embedded diagnostics", () => {
    withEnv({ OPENCLAW_HOME: "/srv/openclaw-home", HOME: "/home/other" }, () => {
      const home = path.resolve("/srv/openclaw-home");
      const configPath = `${home}/.openclaw/openclaw.json`;
      expect(shortenHomePath(configPath)).toBe("$OPENCLAW_HOME/.openclaw/openclaw.json");
      expect(shortenHomeInString(`config: ${configPath}`)).toBe(
        "config: $OPENCLAW_HOME/.openclaw/openclaw.json",
      );
      expect(displayPath(configPath)).toBe("$OPENCLAW_HOME/.openclaw/openclaw.json");
      expect(displayString(`config: ${configPath}`)).toBe(
        "config: $OPENCLAW_HOME/.openclaw/openclaw.json",
      );
    });
  });
});
