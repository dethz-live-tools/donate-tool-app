import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import YAML from "yaml";
import type { AppConfig } from "./types.ts";

export const CONFIG_FILE = path.resolve(process.cwd(), "config.yaml");
export const LEGACY_CONFIG_FILE = path.resolve(process.cwd(), "connector-config.json");

export function loadConfig(): AppConfig {
  try {
    if (fs.existsSync(CONFIG_FILE)) {
      const raw = fs.readFileSync(CONFIG_FILE, "utf-8");
      const parsed = YAML.parse(raw);
      if (parsed) {
        return {
          username: String(parsed.tiktok?.username || "").trim(),
          webhookUri: String(parsed.webhook?.uri || "").trim(),
          spotifyClientId: String(parsed.spotify?.client_id || "").trim(),
          spotifyClientSecret: String(parsed.spotify?.client_secret || "").trim(),
          spotifyRefreshToken: String(parsed.spotify?.refresh_token || "").trim(),
        };
      }
    } else if (fs.existsSync(LEGACY_CONFIG_FILE)) {
      const raw = fs.readFileSync(LEGACY_CONFIG_FILE, "utf-8");
      const data = JSON.parse(raw);
      const migrated: AppConfig = {
        username: String(data.username || "").trim(),
        webhookUri: String(data.webhookUri || "").trim(),
        spotifyClientId: String(data.spotifyClientId || "").trim(),
        spotifyClientSecret: String(data.spotifyClientSecret || "").trim(),
        spotifyRefreshToken: String(data.spotifyRefreshToken || "").trim(),
      };
      saveConfig(migrated);
      return migrated;
    }
  } catch (e) {
    console.error("[config] Failed to load config.yaml:", e);
  }
  return {
    username: "",
    webhookUri: "",
    spotifyClientId: "",
    spotifyClientSecret: "",
    spotifyRefreshToken: "",
  };
}

export function saveConfig(updates: Partial<AppConfig>) {
  try {
    const exists = fs.existsSync(CONFIG_FILE);
    const existing = exists ? loadConfig() : {
      username: "",
      webhookUri: "",
      spotifyClientId: "",
      spotifyClientSecret: "",
      spotifyRefreshToken: "",
    };

    const merged = { ...existing, ...updates };
    const yamlData = {
      tiktok: {
        username: merged.username || "",
      },
      webhook: {
        uri: merged.webhookUri || "",
      },
      spotify: {
        client_id: merged.spotifyClientId || "",
        client_secret: merged.spotifyClientSecret || "",
        refresh_token: merged.spotifyRefreshToken || "",
      },
    };

    const serialized = YAML.stringify(yamlData, { indent: 2 });
    fs.writeFileSync(CONFIG_FILE, serialized, {
      encoding: "utf-8",
      flag: "w",
    });
    console.log(`[config] ${exists ? "Overwrote existing" : "Created and wrote"} ${CONFIG_FILE}`);
  } catch (e) {
    console.error("[config] Failed to save config.yaml:", e);
  }
}
