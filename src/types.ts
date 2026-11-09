export interface WebhookPayload {
  username: string;
  giftName: string;
  coins: number;
}

export interface LogEntry {
  id: string;
  timestamp: string;
  type: "gift" | "test" | "system";
  payload: WebhookPayload;
  webhookUri: string;
  httpStatus?: number;
  response?: string;
  success: boolean;
  error?: string;
}

export interface SpotifyTrack {
  name: string;
  artist: string;
  album: string;
  albumArt: string | null;
  durationMs: number;
  progressMs: number;
  isPlaying: boolean;
  playlistName?: string | null;
  playlistUri?: string | null;
}

export interface SpotifyInfo {
  clientId: string;
  hasClientSecret?: boolean;
  connected: boolean;
  currentTrack: SpotifyTrack | null;
  error: string | null;
}

export interface ServerState {
  username: string;
  webhookUri: string;
  status: "disconnected" | "connecting" | "connected" | "error";
  roomId: string | null;
  error: string | null;
  logs: LogEntry[];
  spotify?: SpotifyInfo;
}
