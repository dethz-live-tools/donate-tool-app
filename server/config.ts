import fs from "node:fs";
import { randomUUID } from "node:crypto";
import path from "node:path";
import process from "node:process";
import YAML from "yaml";
import type { AppConfig, ChatRole, StudioLayer, StudioProfile, StudioScene } from "./types.ts";
import { PORT } from "./utils.ts";

const ALL_ROLES: ChatRole[] = ["owner", "moderator", "subscriber", "follower", "guest"];

function normalizeRoles(raw: unknown): ChatRole[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const roles = raw.filter((r): r is ChatRole => typeof r === "string" && (ALL_ROLES as string[]).includes(r));
  return roles.length > 0 ? roles : undefined;
}

const DEFAULT_STUDIO_SCENE: StudioScene = {
  width: 1920,
  height: 1080,
  layers: [],
};

export function isValidExternalLayerUrl(rawUrl: string): boolean {
  if (typeof rawUrl !== "string" || !/^https?:\/\//i.test(rawUrl)) return false;
  try {
    const parsed = new URL(rawUrl);
    if (!["http:", "https:"].includes(parsed.protocol) || parsed.username || parsed.password) return false;
    const hostname = parsed.hostname.toLowerCase();

    // Block cloud metadata services and link-local addresses
    if (
      hostname === "169.254.169.254" ||
      hostname === "169.254.169.253" ||
      hostname === "metadata.google.internal" ||
      hostname.startsWith("169.254.") ||
      hostname === "[fd00:ec2::254]" ||
      hostname.startsWith("fe80:")
    ) {
      return false;
    }

    // Block loopback targeting application own API port (prevents iframe sandbox escape)
    const port = parsed.port ? Number(parsed.port) : (parsed.protocol === "https:" ? 443 : 80);
    const isLoopback = hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1" || hostname === "[::1]";
    if (isLoopback && (port === 3001 || port === PORT)) {
      return false;
    }

    return true;
  } catch {
    return false;
  }
}

export function normalizeStudioScene(raw: unknown): StudioScene {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { ...DEFAULT_STUDIO_SCENE, layers: [] };
  }
  const obj = raw as Record<string, unknown>;
  const width = Math.max(320, Math.min(7680, Number(obj.width) || 1920));
  const height = Math.max(240, Math.min(4320, Number(obj.height) || 1080));
  let layerIndex = 0;
  const layers: StudioLayer[] = Array.isArray(obj.layers)
    ? obj.layers
        .flatMap((l): StudioLayer[] => {
          if (!l || typeof l !== "object" || Array.isArray(l) || l.overlayId === "studio") return [];
          let url: string | undefined;
          let overlayId = "";
          if (l.url !== undefined) {
            if (!isValidExternalLayerUrl(l.url)) return [];
            try {
              url = new URL(l.url).href;
            } catch {
              return [];
            }
          } else {
            overlayId = String(l.overlayId || "").replace(/[^a-zA-Z0-9_-]/g, "");
            if (!overlayId || overlayId === "studio") return [];
          }
          const idx = layerIndex++;
          return [{
            id: String(l.id || `layer-${idx}-${Date.now()}`),
            overlayId,
            ...(url !== undefined ? { url } : {}),
            name: String(l.name || url || l.overlayId),
            x: Math.round(Number(l.x) || 0),
            y: Math.round(Number(l.y) || 0),
            width: Math.max(40, Math.round(Number(l.width) || 400)),
            height: Math.max(20, Math.round(Number(l.height) || 150)),
            scale: Math.max(0.1, Math.min(5, Number(l.scale ?? 1))),
            opacity: Math.max(0, Math.min(1, Number(l.opacity ?? 1))),
            zIndex: Number.isFinite(Number(l.zIndex)) ? Math.round(Number(l.zIndex)) : idx + 1,
            visible: l.visible !== false,
            locked: Boolean(l.locked),
          }];
        })
    : [];
  return { width, height, layers };
}

function normalizeStudioProfiles(raw: unknown): StudioProfile[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((profile): profile is StudioProfile =>
      Boolean(profile && typeof profile === "object" &&
        typeof profile.id === "string" && profile.id.trim() &&
        typeof profile.name === "string" && profile.name.trim() && profile.name.trim().length <= 100 &&
        profile.scene && typeof profile.scene === "object" && !Array.isArray(profile.scene))
    )
    .map((profile) => ({
      id: profile.id,
      name: profile.name.trim(),
      scene: normalizeStudioScene(profile.scene),
    }));
}

export const CONFIG_FILE = path.resolve(process.env.DONATE_CONFIG_FILE || "config.yaml");
export const LEGACY_CONFIG_FILE = path.join(path.dirname(CONFIG_FILE), "connector-config.json");

function initializeConfig() {
  const template = process.env.DONATE_CONFIG_TEMPLATE;
  if (!template || fs.existsSync(CONFIG_FILE) || fs.existsSync(LEGACY_CONFIG_FILE)) return;
  const raw = fs.readFileSync(template, "utf-8");
  fs.mkdirSync(path.dirname(CONFIG_FILE), { recursive: true, mode: 0o700 });
  try {
    fs.writeFileSync(CONFIG_FILE, raw, { encoding: "utf-8", flag: "wx", mode: 0o600 });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
  }
}

export function loadConfig(): AppConfig {
  return readConfig(false);
}

function readConfig(throwOnError: boolean): AppConfig {
  try {
    initializeConfig();
    if (fs.existsSync(CONFIG_FILE)) {
      const raw = fs.readFileSync(CONFIG_FILE, "utf-8");
      const parsed = YAML.parse(raw);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        throw new Error("config.yaml must contain a YAML mapping");
      }
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
          ...(normalizeRoles(parsed.tts?.allowed_roles) ? { allowedRoles: normalizeRoles(parsed.tts?.allowed_roles) } : {}),
        },
        ...(normalizeRoles(parsed.commands?.allowed_roles) ? { commands: { allowedRoles: normalizeRoles(parsed.commands?.allowed_roles) } } : {}),
        ui: {
          minimizedBoxes: parsed.ui?.minimized_boxes || {},
        },
        studio: normalizeStudioScene(parsed.studio),
        studioProfiles: normalizeStudioProfiles(parsed.studioProfiles),
      };
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
        studio: { ...DEFAULT_STUDIO_SCENE, layers: [] },
        studioProfiles: [],
      };
      saveConfig(migrated);
      return migrated;
    }
  } catch (e) {
    if (throwOnError) throw e;
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
    studio: { ...DEFAULT_STUDIO_SCENE, layers: [] },
    studioProfiles: [],
  };
}

export function getPublicConfig(config: AppConfig): AppConfig {
  return {
    ...config,
    spotifyClientSecret: config.spotifyClientSecret ? "••••••••" : "",
    spotifyRefreshToken: config.spotifyRefreshToken ? "••••••••" : "",
  };
}

export function saveConfig(updates: Partial<AppConfig>) {
  try {
    initializeConfig();
    const exists = fs.existsSync(CONFIG_FILE);
    const existing = exists ? readConfig(true) : {
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
      studio: { ...DEFAULT_STUDIO_SCENE, layers: [] },
      studioProfiles: [],
    };

    const sendTts = updates.sendTtsWebhook !== undefined
      ? updates.sendTtsWebhook
      : (updates.tts?.sendWebhook !== undefined ? updates.tts.sendWebhook : existing.sendTtsWebhook);

    const merged: AppConfig = {
      username: updates.username !== undefined ? updates.username : existing.username,
      webhookUri: updates.webhookUri !== undefined ? updates.webhookUri : existing.webhookUri,
      sendTtsWebhook: sendTts,
      spotifyClientId: updates.spotifyClientId !== undefined ? updates.spotifyClientId : existing.spotifyClientId,
      spotifyClientSecret:
        updates.spotifyClientSecret !== undefined &&
        updates.spotifyClientSecret !== "••••••••" &&
        updates.spotifyClientSecret.trim() !== ""
          ? updates.spotifyClientSecret.trim()
          : existing.spotifyClientSecret,
      spotifyRefreshToken:
        updates.spotifyRefreshToken !== undefined &&
        updates.spotifyRefreshToken !== "••••••••" &&
        updates.spotifyRefreshToken.trim() !== ""
          ? updates.spotifyRefreshToken.trim()
          : existing.spotifyRefreshToken,
      tts: {
        ...existing.tts,
        ...updates.tts,
        sendWebhook: sendTts,
        ...(normalizeRoles(updates.tts?.allowedRoles ?? existing.tts?.allowedRoles)
          ? { allowedRoles: normalizeRoles(updates.tts?.allowedRoles ?? existing.tts?.allowedRoles) }
          : {}),
      },
      ...(normalizeRoles(updates.commands?.allowedRoles ?? existing.commands?.allowedRoles)
        ? { commands: { allowedRoles: normalizeRoles(updates.commands?.allowedRoles ?? existing.commands?.allowedRoles) } }
        : {}),
      ui: {
        minimizedBoxes: updates.ui?.minimizedBoxes !== undefined
          ? { ...existing.ui?.minimizedBoxes, ...updates.ui.minimizedBoxes }
          : existing.ui?.minimizedBoxes,
      },
      studio: updates.studio !== undefined
        ? normalizeStudioScene(updates.studio)
        : normalizeStudioScene(existing.studio),
      studioProfiles: normalizeStudioProfiles(updates.studioProfiles ?? existing.studioProfiles),
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
        ...(merged.tts?.allowedRoles ? { allowed_roles: merged.tts.allowedRoles } : {}),
      },
      ...(merged.commands?.allowedRoles ? { commands: { allowed_roles: merged.commands.allowedRoles } } : {}),
      ui: {
        minimized_boxes: merged.ui?.minimizedBoxes || {},
      },
      studio: merged.studio || DEFAULT_STUDIO_SCENE,
      studioProfiles: merged.studioProfiles,
    };

    const serialized = YAML.stringify(yamlData, { indent: 2 });
    fs.mkdirSync(path.dirname(CONFIG_FILE), { recursive: true, mode: 0o700 });
    const temporaryFile = `${CONFIG_FILE}.${randomUUID()}.tmp`;
    try {
      fs.writeFileSync(temporaryFile, serialized, { encoding: "utf-8", flag: "wx", mode: 0o600 });
      fs.renameSync(temporaryFile, CONFIG_FILE);
    } finally {
      fs.rmSync(temporaryFile, { force: true });
    }
    console.log(`[config] ${exists ? "Overwrote existing" : "Created and wrote"} ${CONFIG_FILE}`);
    return true;
  } catch (e) {
    console.error("[config] Failed to save config.yaml:", e);
    return false;
  }
}
