import { afterAll, afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { EventEmitter } from "node:events";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "donate-tiktok-test-"));
process.env.DONATE_CONFIG_FILE = path.join(tempDir, "config.yaml");

const ControlEvent = {
  CONNECTED: "connected",
  DISCONNECTED: "disconnected",
  ERROR: "error",
} as const;

const WebcastEvent = {
  CHAT: "chat",
  GIFT: "gift",
  STREAM_END: "streamEnd",
} as const;

interface FakeBehavior {
  isLive: boolean | Error | (() => Promise<boolean>);
  connect?: (conn: FakeConnection) => Promise<void>;
}

const instances: FakeConnection[] = [];
let nextBehaviors: FakeBehavior[] = [];
let defaultBehavior: FakeBehavior = { isLive: false };

class FakeConnection extends EventEmitter {
  uniqueId: string;
  options: any;
  roomId = "";
  isConnected = false;
  fetchIsLiveCalls = 0;
  connectCalls = 0;
  disconnectCalls = 0;
  private behavior: FakeBehavior;

  constructor(uniqueId: string, options: any) {
    super();
    this.uniqueId = uniqueId;
    this.options = options;
    this.behavior = nextBehaviors.shift() ?? defaultBehavior;
    instances.push(this);
  }

  async fetchIsLive(): Promise<boolean> {
    this.fetchIsLiveCalls++;
    const { isLive } = this.behavior;
    if (typeof isLive === "function") return await isLive();
    if (isLive instanceof Error) throw isLive;
    return isLive;
  }

  async connect(): Promise<void> {
    this.connectCalls++;
    if (this.behavior.connect) {
      await this.behavior.connect(this);
      return;
    }
    this.roomId = `room-${instances.length}`;
    this.isConnected = true;
    this.emit(ControlEvent.CONNECTED, { roomId: this.roomId });
  }

  async disconnect(): Promise<void> {
    this.disconnectCalls++;
    if (this.isConnected) {
      this.isConnected = false;
      this.emit(ControlEvent.DISCONNECTED);
    }
  }
}

mock.module("tiktok-live-connector", () => ({
  ControlEvent,
  WebcastEvent,
  RouteConfig: {
    fetchWebcastSignatureFromProvider: async (args: any) => args,
  },
  TikTokLiveConnection: FakeConnection,
}));

const { LIVE_CHECK_INTERVAL_MS, connectLive, disconnectLive, getActiveConnection } = await import(
  "./services/tiktok.ts"
);
const { state } = await import("./state.ts");

interface ScheduledTimer {
  id: number;
  fn: () => void;
  delay: number;
  cleared: boolean;
}

let realSetTimeout: typeof globalThis.setTimeout;
let realClearTimeout: typeof globalThis.clearTimeout;
let timers: ScheduledTimer[] = [];
let nextTimerId = 1;

function activeTimers(): ScheduledTimer[] {
  return timers.filter((t) => !t.cleared);
}

async function runNextTimer() {
  const timer = activeTimers()[0];
  if (!timer) throw new Error("No active timer to run");
  timer.cleared = true;
  timer.fn();
  await flushMicrotasks();
}

async function flushMicrotasks() {
  for (let i = 0; i < 6; i++) {
    await Promise.resolve();
  }
}

beforeEach(() => {
  instances.length = 0;
  nextBehaviors = [];
  defaultBehavior = { isLive: false };
  timers = [];
  nextTimerId = 1;

  realSetTimeout = globalThis.setTimeout;
  realClearTimeout = globalThis.clearTimeout;

  globalThis.setTimeout = ((fn: (...args: any[]) => void, delay = 0) => {
    const entry: ScheduledTimer = { id: nextTimerId++, fn: () => fn(), delay, cleared: false };
    timers.push(entry);
    return entry.id as unknown as NodeJS.Timeout;
  }) as typeof globalThis.setTimeout;

  globalThis.clearTimeout = ((id: any) => {
    const entry = timers.find((t) => t.id === id);
    if (entry) entry.cleared = true;
  }) as typeof globalThis.clearTimeout;
});

afterEach(() => {
  disconnectLive();
  globalThis.setTimeout = realSetTimeout;
  globalThis.clearTimeout = realClearTimeout;
});

afterAll(() => {
  fs.rmSync(tempDir, { recursive: true, force: true });
});

describe("TikTok live interval check", () => {
  test("polls every 30s while offline and connects once streamer goes live", async () => {
    nextBehaviors = [{ isLive: false }, { isLive: false }, { isLive: true }];

    await connectLive("streamer_a", "https://example.test/hook");

    expect(state.status).toBe("connecting");
    expect(state.roomId).toBeNull();
    expect(state.error).toContain("offline");
    expect(getActiveConnection()).toBeNull();
    expect(instances).toHaveLength(1);
    expect(instances[0].fetchIsLiveCalls).toBe(1);
    expect(instances[0].connectCalls).toBe(0);
    expect(activeTimers()).toHaveLength(1);
    expect(activeTimers()[0].delay).toBe(LIVE_CHECK_INTERVAL_MS);

    // Second check: still offline
    await runNextTimer();
    expect(state.status).toBe("connecting");
    expect(instances).toHaveLength(2);
    expect(instances[1].connectCalls).toBe(0);
    expect(activeTimers()).toHaveLength(1);

    // Third check: streamer is now online
    await runNextTimer();
    expect(state.status).toBe("connected");
    expect(state.roomId).toBe("room-3");
    expect(state.error).toBeNull();
    expect(getActiveConnection()).toBe(instances[2]);
    expect(instances[2].connectCalls).toBe(1);
    expect(activeTimers()).toHaveLength(0);
  });

  test("resumes interval check after WebcastEvent.STREAM_END and reconnects when live again", async () => {
    nextBehaviors = [{ isLive: true }, { isLive: false }, { isLive: true }];

    await connectLive("streamer_b", "https://example.test/hook");
    expect(state.status).toBe("connected");
    const firstConn = instances[0];

    // Mirror tiktok-live-connector: emits streamEnd then disconnects
    firstConn.emit(WebcastEvent.STREAM_END, { action: 3 });
    await firstConn.disconnect();

    expect(state.status).toBe("connecting");
    expect(state.roomId).toBeNull();
    expect(state.error).toContain("Live stream ended");
    expect(getActiveConnection()).toBeNull();
    expect(activeTimers()).toHaveLength(1);
    expect(activeTimers()[0].delay).toBe(LIVE_CHECK_INTERVAL_MS);

    // Offline tick
    await runNextTimer();
    expect(state.status).toBe("connecting");
    expect(activeTimers()).toHaveLength(1);

    // Stream restarts
    await runNextTimer();
    expect(state.status).toBe("connected");
    expect(state.roomId).toBe("room-3");
    expect(state.error).toBeNull();
    expect(activeTimers()).toHaveLength(0);
  });

  test("resumes interval check after unexpected ControlEvent.DISCONNECTED", async () => {
    nextBehaviors = [{ isLive: true }, { isLive: true }];

    await connectLive("streamer_c", "https://example.test/hook");
    expect(state.status).toBe("connected");

    await instances[0].disconnect();

    expect(state.status).toBe("connecting");
    expect(state.roomId).toBeNull();
    expect(state.error).toContain("disconnected");
    expect(activeTimers()).toHaveLength(1);

    await runNextTimer();
    expect(state.status).toBe("connected");
    expect(state.roomId).toBe("room-2");
    expect(activeTimers()).toHaveLength(0);
  });

  test("stops interval checking on disconnectLive while waiting offline", async () => {
    nextBehaviors = [{ isLive: false }];

    await connectLive("streamer_d", "https://example.test/hook");
    expect(state.status).toBe("connecting");
    expect(activeTimers()).toHaveLength(1);

    disconnectLive();
    expect(state.status).toBe("disconnected");
    expect(state.error).toBeNull();
    expect(activeTimers()).toHaveLength(0);
  });

  test("disconnects late-resolving connection if disconnectLive is called mid-connect", async () => {
    let releaseConnect!: () => void;
    nextBehaviors = [
      {
        isLive: true,
        connect: async (conn) => {
          await new Promise<void>((resolve) => {
            releaseConnect = resolve;
          });
          conn.roomId = "late-room";
          conn.isConnected = true;
          conn.emit(ControlEvent.CONNECTED, { roomId: "late-room" });
        },
      },
    ];

    const pending = connectLive("streamer_e", "https://example.test/hook");
    await flushMicrotasks();

    disconnectLive();
    expect(state.status).toBe("disconnected");

    releaseConnect();
    await pending;

    expect(state.status).toBe("disconnected");
    expect(state.roomId).toBeNull();
    expect(getActiveConnection()).toBeNull();
    expect(instances[0].disconnectCalls).toBeGreaterThanOrEqual(1);
    expect(activeTimers()).toHaveLength(0);
  });

  test("retries transient errors, honors retryAfter backoff, and stops on InvalidUniqueIdError", async () => {
    const rateLimitErr = Object.assign(new Error("Rate limited"), {
      name: "SignatureRateLimitError",
      retryAfter: 60_000,
    });
    const invalidErr = Object.assign(new Error("Invalid uniqueId"), {
      name: "InvalidUniqueIdError",
    });

    nextBehaviors = [
      { isLive: new Error("temporary network failure") },
      { isLive: rateLimitErr },
      { isLive: invalidErr },
    ];

    await connectLive("streamer_f", "https://example.test/hook");
    expect(state.status).toBe("connecting");
    expect(state.error).toContain("temporary network failure");
    expect(activeTimers()).toHaveLength(1);
    expect(activeTimers()[0].delay).toBe(LIVE_CHECK_INTERVAL_MS);

    await runNextTimer();
    expect(state.status).toBe("connecting");
    expect(activeTimers()).toHaveLength(1);
    expect(activeTimers()[0].delay).toBe(60_000);

    await runNextTimer();
    expect(state.status).toBe("error");
    expect(state.error).toContain("Invalid uniqueId");
    expect(activeTimers()).toHaveLength(0);
  });

  test("keeps active connected status on non-fatal ControlEvent.ERROR", async () => {
    nextBehaviors = [{ isLive: true }];

    await connectLive("streamer_g", "https://example.test/hook");
    expect(state.status).toBe("connected");

    instances[0].emit(ControlEvent.ERROR, {
      info: "Failed to process decoded data",
      exception: new Error("decode glitch"),
    });

    expect(state.status).toBe("connected");
    expect(state.error).toBeNull();
    expect(activeTimers()).toHaveLength(0);
  });

  test("does not start interval check when username is empty", async () => {
    await connectLive("", "https://example.test/hook");
    expect(state.status).toBe("error");
    expect(state.error).toBe("TikTok username is required");
    expect(activeTimers()).toHaveLength(0);
  });
});
