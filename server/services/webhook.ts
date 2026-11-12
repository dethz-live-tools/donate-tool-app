import { broadcastState, state } from "../state.ts";
import type { LogEntry, WebhookPayload } from "../types.ts";
import { PORT } from "../utils.ts";

export function validateWebhookUrl(uri: string): void {
  const parsed = new URL(uri);
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("Only http: and https: webhook protocols allowed");
  }

  // Reject embedded credentials in URL
  if (parsed.username || parsed.password) {
    throw new Error("Credentials in webhook URL are forbidden");
  }

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
    throw new Error("Targeting cloud metadata services or link-local addresses is forbidden");
  }

  // Block webhook targeting the internal application's own API port
  const port = parsed.port ? Number(parsed.port) : (parsed.protocol === "https:" ? 443 : 80);
  const isLoopback = hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1" || hostname === "[::1]";
  if (isLoopback && port === PORT) {
    throw new Error("Webhook cannot target the application's own API port");
  }
}

export async function sendWebhook(
  payload: WebhookPayload,
  type: "gift" | "test" | "system" | "spotify" | "tts" = "gift"
): Promise<LogEntry> {
  const uri = String(state.webhookUri || "").trim();

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
    state.logs.unshift(entry);
    if (state.logs.length > 50) state.logs.pop();
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
    state.logs.unshift(entry);
    if (state.logs.length > 50) state.logs.pop();
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

  state.logs.unshift(entry);
  if (state.logs.length > 50) state.logs.pop();
  broadcastState();
  return entry;
}
