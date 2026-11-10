import type http from "node:http";
import { getTtsVoices, synthesizeEdgeTTS } from "../services/tts.ts";
import { parseJsonBody, sendJson } from "../utils.ts";

export async function handleTtsRoutes(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  url: URL
): Promise<boolean> {
  // GET /api/tts/voices
  if (req.method === "GET" && url.pathname === "/api/tts/voices") {
    try {
      const voices = await getTtsVoices();
      sendJson(res, 200, { voices });
    } catch (err: any) {
      sendJson(res, 500, { error: err?.message || "Failed to list voices" });
    }
    return true;
  }

  // GET /api/tts/speak?text=...&voice=...&rate=...&pitch=...
  if (req.method === "GET" && url.pathname === "/api/tts/speak") {
    const text = url.searchParams.get("text") || "";
    const voice = url.searchParams.get("voice") || undefined;
    const rate = url.searchParams.get("rate") || undefined;
    const pitch = url.searchParams.get("pitch") || undefined;

    if (!text.trim()) {
      sendJson(res, 400, { error: "Query parameter 'text' is required" });
      return true;
    }

    try {
      const audioBuffer = await synthesizeEdgeTTS({ text, voice, rate, pitch });
      res.writeHead(200, {
        "Content-Type": "audio/mpeg",
        "Content-Length": audioBuffer.length,
        "Cache-Control": "public, max-age=86400, immutable",
      });
      res.end(audioBuffer);
    } catch (err: any) {
      console.error("[TTS Route] GET /api/tts/speak failed:", err);
      sendJson(res, 500, { error: err?.message || "Synthesis failed" });
    }
    return true;
  }

  // POST /api/tts/speak
  if (req.method === "POST" && url.pathname === "/api/tts/speak") {
    try {
      const body = await parseJsonBody(req);
      const text = (body.text || "").trim();
      if (!text) {
        sendJson(res, 400, { error: "Body field 'text' is required" });
        return true;
      }

      const audioBuffer = await synthesizeEdgeTTS({
        text,
        voice: body.voice,
        rate: body.rate,
        pitch: body.pitch,
      });

      res.writeHead(200, {
        "Content-Type": "audio/mpeg",
        "Content-Length": audioBuffer.length,
        "Cache-Control": "public, max-age=86400, immutable",
      });
      res.end(audioBuffer);
    } catch (err: any) {
      console.error("[TTS Route] POST /api/tts/speak failed:", err);
      sendJson(res, 500, { error: err?.message || "Synthesis failed" });
    }
    return true;
  }

  return false;
}
