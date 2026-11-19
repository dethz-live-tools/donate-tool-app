import { describe, expect, test } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import { dictionaries, tFor } from "../src/i18n.tsx";

describe("i18n dictionary & tFor", () => {
  test("returns English key and substitutes variables by default", () => {
    expect(tFor("en", "DASHBOARD")).toBe("DASHBOARD");
    expect(tFor("en", "Connected to stream @{username}", { username: "alice" })).toBe("Connected to stream @alice");
  });

  test("translates Thai keys with variable interpolation and falls back on unknown keys", () => {
    expect(tFor("th", "DASHBOARD")).toBe("แดชบอร์ด");
    expect(tFor("th", "Connected to stream @{username}", { username: "alice" })).toBe("เชื่อมต่อสตรีม @alice แล้ว");
    expect(tFor("th", "UNTRANSLATED_FALLBACK_KEY")).toBe("UNTRANSLATED_FALLBACK_KEY");
    expect(tFor("en", "toString")).toBe("toString");
    expect(tFor("th", "constructor")).toBe("constructor");
  });

  test("keeps all Thai values non-empty with matching placeholders and covers static UI keys", () => {
    const files = ["src/App.tsx", ...fs.readdirSync("src/components").map((f) => path.join("src/components", f))];
    const missing: string[] = [];
    for (const file of files) {
      const src = fs.readFileSync(file, "utf8");
      for (const m of src.matchAll(/\bt\(\s*(['"])((?:\\.|(?!\1).)+)\1/g)) {
        const key = m[2].replace(/\\(.)/g, "$1");
        if (!(key in dictionaries.th)) missing.push(`${file}:${key}`);
      }
    }
    expect(missing).toEqual([]);

    for (const [key, value] of Object.entries(dictionaries.th)) {
      expect(value.trim().length).toBeGreaterThan(0);
      const keyVars = [...key.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
      const valVars = [...value.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
      expect(valVars).toEqual(keyVars);
    }
  });
});
