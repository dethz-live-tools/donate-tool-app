import React, { useState, useEffect, useRef } from "react";
import "./App.css";

interface WebhookPayload {
  username: string;
  giftName: string;
  coins: number;
}

interface LogEntry {
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

interface ServerState {
  username: string;
  webhookUri: string;
  status: "disconnected" | "connecting" | "connected" | "error";
  roomId: string | null;
  error: string | null;
  logs: LogEntry[];
}

const API_BASE = "http://127.0.0.1:3001";

export default function App() {
  const [username, setUsername] = useState("");
  const [webhookUri, setWebhookUri] = useState("");
  const [status, setStatus] = useState<"disconnected" | "connecting" | "connected" | "error">("disconnected");
  const [roomId, setRoomId] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<string | null>(null);

  const eventSourceRef = useRef<EventSource | null>(null);

  // Initial load & SSE connection
  useEffect(() => {
    async function fetchStatus() {
      try {
        const res = await fetch(`${API_BASE}/api/status`);
        if (res.ok) {
          const data: ServerState = await res.json();
          if (data.username) setUsername(data.username);
          if (data.webhookUri) setWebhookUri(data.webhookUri);
          setStatus(data.status);
          setRoomId(data.roomId);
          setErrorMsg(data.error);
          setLogs(data.logs || []);
        }
      } catch {
        // Fallback relative path if running behind Vite proxy
        try {
          const res = await fetch("/api/status");
          if (res.ok) {
            const data: ServerState = await res.json();
            if (data.username) setUsername(data.username);
            if (data.webhookUri) setWebhookUri(data.webhookUri);
            setStatus(data.status);
            setRoomId(data.roomId);
            setErrorMsg(data.error);
            setLogs(data.logs || []);
          }
        } catch {
          // Backend might still be starting
        }
      }
    }

    fetchStatus();

    // Setup SSE for live reactive updates
    function connectSse() {
      try {
        const es = new EventSource(`${API_BASE}/api/events`);
        eventSourceRef.current = es;

        es.onmessage = (event) => {
          try {
            const data: ServerState = JSON.parse(event.data);
            setStatus(data.status);
            setRoomId(data.roomId);
            setErrorMsg(data.error);
            setLogs(data.logs || []);
          } catch (e) {
            console.error("SSE parse error:", e);
          }
        };

        es.onerror = () => {
          es.close();
          // Retry SSE after 3 seconds
          setTimeout(connectSse, 3000);
        };
      } catch (err) {
        console.error("Failed to connect SSE:", err);
      }
    }

    connectSse();

    return () => {
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
      }
    };
  }, []);

  async function handleConnect(e: React.FormEvent) {
    e.preventDefault();
    if (!username.trim()) {
      setErrorMsg("TikTok username is required");
      return;
    }
    if (!webhookUri.trim()) {
      setErrorMsg("Webhook URI is required");
      return;
    }

    setLoading(true);
    setErrorMsg(null);
    setTestResult(null);

    try {
      const res = await fetch(`${API_BASE}/api/connect`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: username.trim(), webhookUri: webhookUri.trim() }),
      });
      const data = await res.json();
      if (!data.success) {
        setErrorMsg(data.error || "Failed to start connection");
      }
    } catch (err: any) {
      setErrorMsg(`Backend unreachable: ${err.message}. Ensure bridge server is running.`);
    } finally {
      setLoading(false);
    }
  }

  async function handleDisconnect() {
    setLoading(true);
    try {
      await fetch(`${API_BASE}/api/disconnect`, { method: "POST" });
    } catch (err: any) {
      setErrorMsg(`Error disconnecting: ${err.message}`);
    } finally {
      setLoading(false);
    }
  }

  async function handleTestWebhook() {
    if (!webhookUri.trim()) {
      setErrorMsg("Please enter a Webhook URI to test");
      return;
    }

    setTesting(true);
    setTestResult(null);
    setErrorMsg(null);

    try {
      const res = await fetch(`${API_BASE}/api/test-webhook`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          webhookUri: webhookUri.trim(),
          username: "gifter_name",
          giftName: "Rose",
          coins: 20,
        }),
      });
      const data = await res.json();
      if (data.success) {
        setTestResult(`Test webhook delivered successfully (Status ${data.entry?.httpStatus || 200})`);
      } else {
        setErrorMsg(`Test webhook failed: ${data.entry?.error || data.error || "Unknown error"}`);
      }
    } catch (err: any) {
      setErrorMsg(`Could not trigger test webhook: ${err.message}`);
    } finally {
      setTesting(false);
    }
  }

  return (
    <div className="app-container">
      {/* Brutalist RawBlock Header */}
      <header className="app-header">
        <div className="header-title-group">
          <h1>TIKTOK LIVE // WEBHOOK</h1>
          <div className="header-subtitle">
            RAWBLOCK BRUTALIST // CATPPUCCIN MACCHIATO
          </div>
        </div>

        <div className={`status-chip ${status}`}>
          <span className="status-dot"></span>
          <span>
            {status === "connected" && roomId ? `LIVE: ${roomId}` : status.toUpperCase()}
          </span>
        </div>
      </header>

      {/* Error / Alert Display */}
      {errorMsg && (
        <div className="alert-banner">
          <span>[!]</span>
          <span>{errorMsg}</span>
        </div>
      )}

      {testResult && (
        <div className="alert-banner success">
          <span>[OK]</span>
          <span>{testResult}</span>
        </div>
      )}

      {/* Main Configuration Card */}
      <section className="raw-card elevated">
        <div className="card-title">
          <h2>CONFIGURATION & CONNECTION</h2>
          <span className="mono-font" style={{ fontSize: "12px", color: "var(--ctp-subtext0)" }}>
            TIKTOK-LIVE-CONNECTOR
          </span>
        </div>

        <form onSubmit={handleConnect} style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
          <div className="form-group">
            <label className="form-label" htmlFor="tiktok-username">
              TIKTOK USERNAME
            </label>
            <input
              id="tiktok-username"
              className="raw-input"
              type="text"
              placeholder="e.g. streamer_name (without or with @)"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              disabled={status === "connected" || status === "connecting"}
            />
            <span className="form-helper">
              Username of the TikTok account currently broadcasting live.
            </span>
          </div>

          <div className="form-group">
            <label className="form-label" htmlFor="webhook-uri">
              WEBHOOK TARGET URI
            </label>
            <input
              id="webhook-uri"
              className="raw-input"
              type="url"
              placeholder="https://your-server.com/api/webhook"
              value={webhookUri}
              onChange={(e) => setWebhookUri(e.target.value)}
            />
            <span className="form-helper">
              Endpoint that receives HTTP POST requests when gifts are sent.
            </span>
          </div>

          <div className="btn-row">
            {status === "connected" || status === "connecting" ? (
              <button
                type="button"
                className="btn btn-destructive"
                onClick={handleDisconnect}
                disabled={loading}
              >
                DISCONNECT STREAM
              </button>
            ) : (
              <button
                type="submit"
                className="btn btn-primary"
                disabled={loading}
              >
                {loading ? "CONNECTING..." : "CONNECT TO TIKTOK LIVE"}
              </button>
            )}

            <button
              type="button"
              className="btn btn-secondary"
              onClick={handleTestWebhook}
              disabled={testing || !webhookUri.trim()}
            >
              {testing ? "SENDING..." : "SEND TEST WEBHOOK"}
            </button>
          </div>
        </form>
      </section>

      {/* Payload Schema Card */}
      <section className="raw-card">
        <div className="card-title">
          <h3>DISPATCH PAYLOAD SPECIFICATION</h3>
          <span className="mono-font" style={{ fontSize: "12px", color: "var(--ctp-lavender)" }}>
            APPLICATION/JSON
          </span>
        </div>
        <p style={{ fontSize: "13px", color: "var(--ctp-subtext0)" }}>
          Every gift event automatically posts this schema to the configured Webhook URI:
        </p>
        <pre className="code-preview">
{JSON.stringify(
  {
    username: "gifter_name",
    giftName: "Rose",
    coins: 20,
  },
  null,
  2
)}
        </pre>
      </section>

      {/* Activity Log Card */}
      <section className="raw-card">
        <div className="card-title">
          <h3>WEBHOOK DISPATCH LOGS ({logs.length})</h3>
          <button
            type="button"
            className="btn btn-secondary"
            style={{ padding: "4px 10px", fontSize: "11px" }}
            onClick={() => setLogs([])}
          >
            CLEAR LOGS
          </button>
        </div>

        {logs.length === 0 ? (
          <div className="empty-state">
            [ NO DISPATCHES RECORDED YET ]
            <br />
            Connect to a stream or click &quot;SEND TEST WEBHOOK&quot; to test.
          </div>
        ) : (
          <div className="logs-list">
            {logs.map((log) => (
              <div
                key={log.id}
                className={`log-item ${log.success ? "success" : "failed"}`}
              >
                <div className="log-header">
                  <div>
                    <span
                      className="log-type-tag"
                      style={{
                        color: log.type === "test" ? "var(--ctp-lavender)" : "var(--ctp-mauve)",
                        marginRight: "8px",
                      }}
                    >
                      {log.type}
                    </span>
                    <span className="log-time">{log.timestamp}</span>
                  </div>

                  <span className={`log-val ${log.success ? "success" : "error"}`}>
                    {log.success
                      ? `STATUS ${log.httpStatus || 200} OK`
                      : log.error || `FAILED (${log.httpStatus || "ERR"})`}
                  </span>
                </div>

                <div className="log-body">
                  <div className="log-line">
                    <span className="log-key">PAYLOAD:</span>
                    <span className="log-val">
                      {JSON.stringify(log.payload)}
                    </span>
                  </div>
                  <div className="log-line">
                    <span className="log-key">TARGET:</span>
                    <span className="log-val" style={{ color: "var(--ctp-blue)" }}>
                      {log.webhookUri}
                    </span>
                  </div>
                  {log.response && (
                    <div className="log-line">
                      <span className="log-key">RESPONSE:</span>
                      <span className="log-val" style={{ color: "var(--ctp-subtext0)" }}>
                        {log.response}
                      </span>
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
