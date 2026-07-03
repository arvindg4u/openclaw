import { describe, expect, it } from "vitest";
import { safeParseJson } from "./json-coercion.js";

describe("json-coercion", () => {
  it("returns parsed JSON values", () => {
    expect(safeParseJson('{"ok":true}')).toEqual({ ok: true });
    expect(safeParseJson('[1,"two"]')).toEqual([1, "two"]);
    expect(safeParseJson("null")).toBeNull();
    expect(safeParseJson('"text"')).toBe("text");
  });

  it("returns undefined for invalid JSON", () => {
    expect(safeParseJson("")).toBeUndefined();
    expect(safeParseJson("{")).toBeUndefined();
    expect(safeParseJson("undefined")).toBeUndefined();
  });

  it("keeps prototype-looking keys as inert own properties", () => {
    const parsed = safeParseJson('{"__proto__":{"polluted":true}}') as Record<string, unknown>;

    expect(Object.hasOwn(parsed, "__proto__")).toBe(true);
    expect(Object.getOwnPropertyDescriptor(parsed, "__proto__")?.value).toEqual({
      polluted: true,
    });
    expect(({} as { polluted?: boolean }).polluted).toBeUndefined();
  });
});
