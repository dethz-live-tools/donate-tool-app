import type { ScreenShareStatus } from "../types";

export interface ScreenShareClientCallbacks {
  onStatus: (status: ScreenShareStatus) => void;
  onStream: (stream: MediaStream | null) => void;
  onError?: (message: string) => void;
}

function waitForIceGathering(pc: RTCPeerConnection, timeoutMs: number): Promise<void> {
  if (pc.iceGatheringState === "complete") return Promise.resolve();
  return new Promise((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      pc.removeEventListener("icegatheringstatechange", onState);
      pc.removeEventListener("icecandidate", onCandidate);
      resolve();
    };
    const onState = () => {
      if (pc.iceGatheringState === "complete") finish();
    };
    const onCandidate = (e: RTCPeerConnectionIceEvent) => {
      if (!e.candidate) finish();
    };
    const timer = setTimeout(finish, timeoutMs);
    pc.addEventListener("icegatheringstatechange", onState);
    pc.addEventListener("icecandidate", onCandidate);
  });
}

export class ScreenShareClient {
  private apiBase: string;
  private callbacks: ScreenShareClientCallbacks;
  private es: EventSource | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private disposed = false;

  private peerId: string | null = null;
  private activeSessionId: string | null = null;
  private isPrimary = false;
  private mainPc: RTCPeerConnection | null = null;
  private remoteStream: MediaStream | null = null;
  private pendingIce: RTCIceCandidateInit[] = [];
  private connectedTimer: ReturnType<typeof setTimeout> | null = null;
  private mirrorPcs = new Map<string, RTCPeerConnection>();

  constructor(apiBase: string, callbacks: ScreenShareClientCallbacks) {
    this.apiBase = apiBase;
    this.callbacks = callbacks;
  }

  start() {
    this.disposed = false;
    if (this.es) return;
    this.connectSse();
  }

  stop() {
    this.disposed = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.es) {
      this.es.close();
      this.es = null;
    }
    this.cleanupSession();
    this.peerId = null;
  }

  reportVideoDimensions(width: number, height: number) {
    if (!this.isPrimary || !this.activeSessionId || !this.peerId || !this.remoteStream) return;
    if (!width || !height) return;
    void this.postJson("/api/screen-share/connected", {
      sessionId: this.activeSessionId,
      peerId: this.peerId,
      width,
      height,
      hasAudio: this.remoteStream.getAudioTracks().length > 0,
    });
  }

  private postJson(path: string, body: unknown): Promise<void> {
    return fetch(`${this.apiBase}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    })
      .then(() => undefined)
      .catch(() => undefined);
  }

  private cleanupSession() {
    if (this.connectedTimer) {
      clearTimeout(this.connectedTimer);
      this.connectedTimer = null;
    }
    for (const pc of this.mirrorPcs.values()) {
      try {
        pc.close();
      } catch {}
    }
    this.mirrorPcs.clear();
    if (this.mainPc) {
      try {
        this.mainPc.close();
      } catch {}
      this.mainPc = null;
    }
    const hadStream = this.remoteStream !== null;
    this.remoteStream = null;
    this.pendingIce = [];
    this.activeSessionId = null;
    this.isPrimary = false;
    if (hadStream) {
      this.callbacks.onStream(null);
    }
  }

  private connectSse() {
    if (this.disposed) return;
    const es = new EventSource(`${this.apiBase}/api/screen-share/events?role=app`);
    this.es = es;

    es.addEventListener("welcome", (event: MessageEvent) => {
      try {
        const data = JSON.parse(event.data);
        this.peerId = data.peerId || null;
        if (data.status) this.callbacks.onStatus(data.status);
      } catch {}
    });

    es.addEventListener("status", (event: MessageEvent) => {
      try {
        const status: ScreenShareStatus = JSON.parse(event.data);
        this.callbacks.onStatus(status);
      } catch {}
    });

    es.addEventListener("whip-offer", (event: MessageEvent) => {
      try {
        void this.handleWhipOffer(JSON.parse(event.data));
      } catch {}
    });

    es.addEventListener("whip-ice", (event: MessageEvent) => {
      try {
        void this.handleWhipIce(JSON.parse(event.data));
      } catch {}
    });

    es.addEventListener("mirror-start", (event: MessageEvent) => {
      try {
        void this.handleMirrorStart(JSON.parse(event.data));
      } catch {}
    });

    es.addEventListener("mirror-answer", (event: MessageEvent) => {
      try {
        void this.handleMirrorAnswer(JSON.parse(event.data));
      } catch {}
    });

    es.addEventListener("mirror-stop", (event: MessageEvent) => {
      try {
        this.handleMirrorStop(JSON.parse(event.data));
      } catch {}
    });

    es.addEventListener("mirror-offer", (event: MessageEvent) => {
      try {
        void this.handleMirrorOffer(JSON.parse(event.data));
      } catch {}
    });

    es.addEventListener("session-ended", () => {
      this.cleanupSession();
    });

    es.onerror = () => {
      es.close();
      if (this.es === es) this.es = null;
      if (!this.disposed) {
        this.reconnectTimer = setTimeout(() => {
          this.reconnectTimer = null;
          this.connectSse();
        }, 2000);
      }
    };
  }

  private async handleWhipOffer(payload: { sessionId: string; sdp: string }) {
    this.cleanupSession();
    this.activeSessionId = payload.sessionId;
    this.isPrimary = true;

    const pc = new RTCPeerConnection({ iceServers: [] });
    this.mainPc = pc;
    const stream = new MediaStream();
    this.remoteStream = stream;

    const notifyConnected = () => {
      if (this.mainPc !== pc || !this.activeSessionId || !this.peerId) return;
      const videoTrack = stream.getVideoTracks()[0];
      const settings = videoTrack?.getSettings?.();
      void this.postJson("/api/screen-share/connected", {
        sessionId: this.activeSessionId,
        peerId: this.peerId,
        width: settings?.width || undefined,
        height: settings?.height || undefined,
        hasAudio: stream.getAudioTracks().length > 0,
      });
    };

    pc.ontrack = (event) => {
      if (this.mainPc !== pc) return;
      stream.addTrack(event.track);
      this.callbacks.onStream(new MediaStream(stream.getTracks()));
      if (this.connectedTimer) clearTimeout(this.connectedTimer);
      this.connectedTimer = setTimeout(notifyConnected, 150);
    };

    pc.onconnectionstatechange = () => {
      if (this.mainPc !== pc) return;
      if (pc.connectionState === "failed" || pc.connectionState === "closed") {
        const sid = this.activeSessionId;
        const pid = this.peerId;
        this.cleanupSession();
        if (sid && pid) {
          void this.postJson("/api/screen-share/disconnected", { sessionId: sid, peerId: pid });
        }
      }
    };

    try {
      await pc.setRemoteDescription({ type: "offer", sdp: payload.sdp });
      for (const candidate of this.pendingIce) {
        try {
          await pc.addIceCandidate(candidate);
        } catch {}
      }
      this.pendingIce = [];

      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      await waitForIceGathering(pc, 2000);

      await this.postJson("/api/screen-share/answer", {
        sessionId: payload.sessionId,
        peerId: this.peerId,
        sdp: pc.localDescription?.sdp || answer.sdp,
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "WebRTC negotiation failed";
      this.callbacks.onError?.(msg);
      await this.postJson("/api/screen-share/answer", {
        sessionId: payload.sessionId,
        peerId: this.peerId,
        error: msg,
      });
      this.cleanupSession();
    }
  }

  private async handleWhipIce(payload: { sessionId: string; candidates?: RTCIceCandidateInit[] }) {
    if (!this.mainPc || !this.isPrimary || payload.sessionId !== this.activeSessionId) return;
    for (const candidate of payload.candidates || []) {
      if (!this.mainPc.remoteDescription) {
        this.pendingIce.push(candidate);
      } else {
        try {
          await this.mainPc.addIceCandidate(candidate);
        } catch {}
      }
    }
  }

  private async handleMirrorStart(payload: { sessionId: string; viewerId: string }) {
    if (!this.isPrimary || !this.remoteStream || payload.sessionId !== this.activeSessionId || !this.peerId) {
      return;
    }
    const existing = this.mirrorPcs.get(payload.viewerId);
    if (existing) {
      try {
        existing.close();
      } catch {}
    }

    const pc = new RTCPeerConnection({ iceServers: [] });
    this.mirrorPcs.set(payload.viewerId, pc);
    for (const track of this.remoteStream.getTracks()) {
      pc.addTrack(track, this.remoteStream);
    }

    pc.onconnectionstatechange = () => {
      if (pc.connectionState === "failed" || pc.connectionState === "closed") {
        if (this.mirrorPcs.get(payload.viewerId) === pc) {
          this.mirrorPcs.delete(payload.viewerId);
        }
      }
    };

    try {
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      await waitForIceGathering(pc, 1000);
      await this.postJson("/api/screen-share/mirror/offer", {
        sessionId: payload.sessionId,
        peerId: this.peerId,
        viewerId: payload.viewerId,
        sdp: pc.localDescription?.sdp || offer.sdp,
      });
    } catch {
      try {
        pc.close();
      } catch {}
      this.mirrorPcs.delete(payload.viewerId);
    }
  }

  private async handleMirrorAnswer(payload: { viewerId: string; sdp: string }) {
    const pc = this.mirrorPcs.get(payload.viewerId);
    if (!pc) return;
    try {
      await pc.setRemoteDescription({ type: "answer", sdp: payload.sdp });
    } catch {}
  }

  private handleMirrorStop(payload: { viewerId: string }) {
    const pc = this.mirrorPcs.get(payload.viewerId);
    if (!pc) return;
    try {
      pc.close();
    } catch {}
    this.mirrorPcs.delete(payload.viewerId);
  }

  private async handleMirrorOffer(payload: { sessionId: string; sdp: string }) {
    this.cleanupSession();
    this.activeSessionId = payload.sessionId;
    this.isPrimary = false;

    const pc = new RTCPeerConnection({ iceServers: [] });
    this.mainPc = pc;
    const stream = new MediaStream();
    this.remoteStream = stream;

    pc.ontrack = (event) => {
      if (this.mainPc !== pc) return;
      stream.addTrack(event.track);
      this.callbacks.onStream(new MediaStream(stream.getTracks()));
    };

    pc.onconnectionstatechange = () => {
      if (this.mainPc === pc && (pc.connectionState === "failed" || pc.connectionState === "closed")) {
        this.cleanupSession();
      }
    };

    try {
      await pc.setRemoteDescription({ type: "offer", sdp: payload.sdp });
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      await waitForIceGathering(pc, 1000);
      await this.postJson("/api/screen-share/mirror/answer", {
        sessionId: payload.sessionId,
        peerId: this.peerId,
        sdp: pc.localDescription?.sdp || answer.sdp,
      });
    } catch {
      this.cleanupSession();
    }
  }
}
