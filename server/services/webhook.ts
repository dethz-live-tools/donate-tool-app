import { broadcastState, state } from "../state.ts";
import type { LogEntry, WebhookPayload } from "../types.ts";

export async function sendWebhook(
  payload: WebhookPayload,
  type: "gift" | "test" | "system" | "spotify" = "gift"
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

  // Enforce http/https protocol security
  try {
    const parsedUrl = new URL(uri);
    if (parsedUrl.protocol !== "http:" && parsedUrl.protocol !== "https:") {
      throw new Error("Only http: and https: webhook protocols allowed");
    }
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
