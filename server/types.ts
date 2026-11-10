export interface AppConfig {
  username: string;
  webhookUri: string;
  spotifyClientId: string;
  spotifyClientSecret: string;
  spotifyRefreshToken: string;
}

export interface TikTokGiftPayload {
  username: string;
  giftName: string;
  coins: number;
}

export interface SpotifyWebhookPayload {
  event: "spotify_status";
  isPlaying: boolean;
  trackName: string | null;
  artist: string | null;
  album: string | null;
  albumArt: string | null;
  durationMs: number;
  progressMs: number;
  playlistName?: string | null;
  playlistUri?: string | null;
  track: SpotifyTrack | null;
  device?: SpotifyDevice | null;
  timestamp: number;
}

export type WebhookPayload = TikTokGiftPayload | SpotifyWebhookPayload | Record<string, any>;

export interface LogEntry {
  id: string;
  timestamp: string;
  type: "gift" | "test" | "system" | "spotify";
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

export interface SpotifyDevice {
  id: string;
  name: string;
  type: string;
  isActive: boolean;
  volumePercent?: number;
}

export interface CurrentSongItem {
  id: string;
  name: string;
  artist: string;
  album: string;
  albumArt: string | null;
  durationMs: number;
  uri: string;
  isPlaying: boolean;
}

export interface CurrentSongListResponse {
  contextName: string | null;
  contextType: string | null;
  contextUri: string | null;
  total: number;
  tracks: CurrentSongItem[];
}

export interface SpotifyInfo {
  clientId: string;
  hasClientSecret: boolean;
  connected: boolean;
  currentTrack: SpotifyTrack | null;
  activeDevice?: SpotifyDevice | null;
  error: string | null;
}

export interface ServerState {
  username: string;
  webhookUri: string;
  status: "disconnected" | "connecting" | "connected" | "error";
  roomId: string | null;
  error: string | null;
  logs: LogEntry[];
  spotify: SpotifyInfo;
}

export interface SpotifyState {
  clientId: string;
  clientSecret: string;
  accessToken: string | null;
  refreshToken: string | null;
  tokenExpiresAt: number;
  connected: boolean;
  currentTrack: SpotifyTrack | null;
  activeDevice?: SpotifyDevice | null;
  error: string | null;
}

export interface SpotifyPlaylist {
  id: string;
  name: string;
  uri: string;
  description?: string;
  totalTracks: number;
  image?: string | null;
  isPublic: boolean;
  collaborative: boolean;
}
