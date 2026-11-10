import type http from "node:http";
import { handleOverlayRoutes } from "./overlays.ts";
import { handleSpotifyRoutes } from "./spotify.ts";
import { handleStatusRoutes } from "./status.ts";
import { handleTiktokRoutes } from "./tiktok.ts";
import { handleTtsRoutes } from "./tts.ts";

export async function handleRoutes(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  url: URL
): Promise<boolean> {
  if (await handleStatusRoutes(req, res, url)) return true;
  if (await handleTtsRoutes(req, res, url)) return true;
  if (await handleTiktokRoutes(req, res, url)) return true;
  if (await handleSpotifyRoutes(req, res, url)) return true;
  if (await handleOverlayRoutes(req, res, url)) return true;
  return false;
}
