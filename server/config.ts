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
          sendTtsWebhook: Boolean(parsed.webhook?.send_tts ?? parsed.tts?.send_webhook ?? false),
          spotifyClientId: String(parsed.spotify?.client_id || "").trim(),
          spotifyClientSecret: String(parsed.spotify?.client_secret || "").trim(),
          spotifyRefreshToken: String(parsed.spotify?.refresh_token || "").trim(),
          tts: {
            enabled: Boolean(parsed.tts?.enabled ?? false),
            voice: String(parsed.tts?.voice || "th-TH-NiwatNeural").trim(),
            volume: typeof parsed.tts?.volume === "number" ? parsed.tts.volume : 1.0,
            rate: typeof parsed.tts?.rate === "number" ? parsed.tts.rate : 1.0,
            pitch: typeof parsed.tts?.pitch === "number" ? parsed.tts.pitch : 1.0,
            template: String(parsed.tts?.template || "{nickname} says {comment}"),
            ignoreBotCommands: parsed.tts?.ignore_bot_commands !== false,
            sendWebhook: Boolean(parsed.tts?.send_webhook ?? parsed.webhook?.send_tts ?? false),
          },
          ui: {
            minimizedBoxes: parsed.ui?.minimized_boxes || {},
          },
        };
      }
    } else if (fs.existsSync(LEGACY_CONFIG_FILE)) {
      const raw = fs.readFileSync(LEGACY_CONFIG_FILE, "utf-8");
      const data = JSON.parse(raw);
      const migrated: AppConfig = {
        username: String(data.username || "").trim(),
        webhookUri: String(data.webhookUri || "").trim(),
        sendTtsWebhook: false,
        spotifyClientId: String(data.spotifyClientId || "").trim(),
        spotifyClientSecret: String(data.spotifyClientSecret || "").trim(),
        spotifyRefreshToken: String(data.spotifyRefreshToken || "").trim(),
        tts: {
          enabled: false,
          voice: "th-TH-NiwatNeural",
          volume: 1.0,
          rate: 1.0,
          pitch: 1.0,
          template: "{nickname} says {comment}",
          ignoreBotCommands: true,
          sendWebhook: false,
        },
        ui: {
          minimizedBoxes: {},
        },
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
    sendTtsWebhook: false,
    spotifyClientId: "",
    spotifyClientSecret: "",
    spotifyRefreshToken: "",
    tts: {
      enabled: false,
      voice: "th-TH-NiwatNeural",
      volume: 1.0,
      rate: 1.0,
      pitch: 1.0,
      template: "{nickname} says {comment}",
      ignoreBotCommands: true,
      sendWebhook: false,
    },
    ui: {
      minimizedBoxes: {},
    },
  };
}

export function saveConfig(updates: Partial<AppConfig>) {
  try {
    const exists = fs.existsSync(CONFIG_FILE);
    const existing = exists ? loadConfig() : {
      username: "",
      webhookUri: "",
      sendTtsWebhook: false,
      spotifyClientId: "",
      spotifyClientSecret: "",
      spotifyRefreshToken: "",
      tts: {
        enabled: false,
        voice: "th-TH-NiwatNeural",
        volume: 1.0,
        rate: 1.0,
        pitch: 1.0,
        template: "{nickname} says {comment}",
        ignoreBotCommands: true,
        sendWebhook: false,
      },
      ui: {
        minimizedBoxes: {},
      },
    };

    const sendTts = updates.sendTtsWebhook !== undefined
      ? updates.sendTtsWebhook
      : (updates.tts?.sendWebhook !== undefined ? updates.tts.sendWebhook : existing.sendTtsWebhook);

    const merged: AppConfig = {
      username: updates.username !== undefined ? updates.username : existing.username,
      webhookUri: updates.webhookUri !== undefined ? updates.webhookUri : existing.webhookUri,
      sendTtsWebhook: sendTts,
      spotifyClientId: updates.spotifyClientId !== undefined ? updates.spotifyClientId : existing.spotifyClientId,
      spotifyClientSecret: updates.spotifyClientSecret !== undefined ? updates.spotifyClientSecret : existing.spotifyClientSecret,
      spotifyRefreshToken: updates.spotifyRefreshToken !== undefined ? updates.spotifyRefreshToken : existing.spotifyRefreshToken,
      tts: {
        ...existing.tts,
        ...updates.tts,
        sendWebhook: sendTts,
      },
      ui: {
        minimizedBoxes: updates.ui?.minimizedBoxes !== undefined
          ? { ...existing.ui?.minimizedBoxes, ...updates.ui.minimizedBoxes }
          : existing.ui?.minimizedBoxes,
      },
    };

    const yamlData = {
      tiktok: {
        username: merged.username || "",
      },
      webhook: {
        uri: merged.webhookUri || "",
        send_tts: Boolean(merged.tts?.sendWebhook ?? merged.sendTtsWebhook),
      },
      spotify: {
        client_id: merged.spotifyClientId || "",
        client_secret: merged.spotifyClientSecret || "",
        refresh_token: merged.spotifyRefreshToken || "",
      },
      tts: {
        enabled: Boolean(merged.tts?.enabled),
        voice: merged.tts?.voice || "th-TH-NiwatNeural",
        volume: Number(merged.tts?.volume ?? 1),
        rate: Number(merged.tts?.rate ?? 1),
        pitch: Number(merged.tts?.pitch ?? 1),
        template: merged.tts?.template || "{nickname} says {comment}",
        ignore_bot_commands: Boolean(merged.tts?.ignoreBotCommands ?? true),
        send_webhook: Boolean(merged.tts?.sendWebhook ?? merged.sendTtsWebhook),
      },
      ui: {
        minimized_boxes: merged.ui?.minimizedBoxes || {},
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
