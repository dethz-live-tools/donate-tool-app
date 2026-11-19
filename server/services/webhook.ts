import { broadcastState, state } from "../state.ts";
import type { LogEntry, WebhookPayload } from "../types.ts";
import { classifyBlockedHost, PORT } from "../utils.ts";

export function validateWebhookUrl(uri: string): void {
  const parsed = new URL(uri);
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("Only http: and https: webhook protocols allowed");
  }

  // Reject embedded credentials in URL
  if (parsed.username || parsed.password) {
    throw new Error("Credentials in webhook URL are forbidden");
  }

  const blocked = classifyBlockedHost(parsed.hostname);
  if (blocked === "metadata") {
    throw new Error("Targeting cloud metadata services or link-local addresses is forbidden");
  }
  const port = parsed.port ? Number(parsed.port) : (parsed.protocol === "https:" ? 443 : 80);
  if (blocked === "loopback" && (port === 3001 || port === PORT)) {
    throw new Error("Webhook cannot target the application's own API port");
  }
}

function pushLog(entry: LogEntry) {
  state.logs.unshift(entry);
  // Keep up to 50 per type so gift volume never evicts tts/spotify logs
  const sameType = state.logs.filter((l) => l.type === entry.type);
  if (sameType.length > 50) {
    const oldestSame = state.logs.indexOf(sameType[sameType.length - 1]);
    state.logs.splice(oldestSame, 1);
  }
  if (state.logs.length > 250) state.logs.pop();
}

export async function sendWebhook(
  payload: WebhookPayload,
  type: "gift" | "test" | "system" | "spotify" | "tts" = "gift"
): Promise<LogEntry> {
  const uri = String(
    (type === "tts"
      ? state.webhookUriChat || state.webhookUri
      : type === "spotify"
        ? state.webhookUriSpotify || state.webhookUri
        : state.webhookUri) || ""
  ).trim();

  if (!uri) {
    const entry: LogEntry = {
      id: Math.random().toString(36).slice(2, 9),
      timestamp: new Date().toLocaleTimeString(),
      type,
      payload,
      webhookUri: "(not configured)",
      success: false,
      error: "Webhook URI is empty",
    };
    pushLog(entry);
    broadcastState();
    return entry;
  }

  // Enforce protocol and SSRF security validations
  try {
    validateWebhookUrl(uri);
  } catch (urlErr: any) {
    const entry: LogEntry = {
      id: Math.random().toString(36).slice(2, 9),
      timestamp: new Date().toLocaleTimeString(),
      type,
      payload,
      webhookUri: uri,
      success: false,
      error: `Invalid Webhook URL: ${urlErr.message}`,
    };
    pushLog(entry);
    broadcastState();
    return entry;
  }

  let entry: LogEntry;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10000);

    const res = await fetch(uri, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
      redirect: "error",
      signal: controller.signal,
    });
    clearTimeout(timer);

    const responseText = await res.text();
    entry = {
      id: Math.random().toString(36).slice(2, 9),
      timestamp: new Date().toLocaleTimeString(),
      type,
      payload,
      webhookUri: uri,
      httpStatus: res.status,
      response: responseText.slice(0, 300),
      success: res.ok,
      error: res.ok ? undefined : `HTTP ${res.status}: ${res.statusText}`,
    };
  } catch (err: any) {
    entry = {
      id: Math.random().toString(36).slice(2, 9),
      timestamp: new Date().toLocaleTimeString(),
      type,
      payload,
      webhookUri: uri,
      httpStatus: 0,
      success: false,
      error: err.name === "AbortError" ? "Request timed out" : (err.message || "Network error"),
    };
  }

  pushLog(entry);
  broadcastState();
  return entry;
}
