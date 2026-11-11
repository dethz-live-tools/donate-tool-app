import React, { useState, useMemo } from "react";
import { OverlayMarketItem, OverlayMeta } from "../types";

function detectOS(): "mac" | "windows" | "linux" {
  if (typeof window === "undefined" || !navigator) return "mac";
  const userAgent = navigator.userAgent || "";
  const platform = (navigator as any).userAgentData?.platform || navigator.platform || "";
  if (/win/i.test(platform) || /windows/i.test(userAgent)) return "windows";
  if (/mac/i.test(platform) || /macintosh|mac os x/i.test(userAgent)) return "mac";
  return "linux";
}

export function extractRepoName(url: string): string {
  if (!url || typeof url !== "string") return "";
  const clean = url.trim().split("?")[0].split("#")[0].replace(/\/+$/, "");

  // Match git hosts like github.com, gitlab.com, bitbucket.org
  const gitHostMatch = clean.match(/(?:github\.com|gitlab\.com|bitbucket\.org)[:/]([^/]+)\/([^/]+)/i);
  if (gitHostMatch) {
    let repoName = gitHostMatch[2];
    repoName = repoName.replace(/\.git$/i, "");
    return repoName.toLowerCase().replace(/[^a-z0-9_-]/g, "-");
  }

  // Handle SSH git format git@...:owner/repo.git
  const sshMatch = clean.match(/[:/]([^/:]+?)(?:\.git)?$/i);
  if (sshMatch && sshMatch[1]) {
    return sshMatch[1].toLowerCase().replace(/[^a-z0-9_-]/g, "-");
  }

  // Path-based fallback
  const parts = clean.split("/").filter(Boolean);
  let last = parts.pop() || "";
  last = last.replace(/\.git$/i, "").replace(/\.zip$/i, "");
  if ((last === "main" || last === "master" || last === "head") && parts.length > 0) {
    const prev = parts.pop() || "";
    if (prev && !["archive", "refs", "heads"].includes(prev)) {
      last = prev;
    }
  }

  return last.toLowerCase().replace(/[^a-z0-9_-]/g, "-");
}

interface OverlaysTabProps {
  apiBase: string;
  installedOverlays: OverlayMeta[];
  marketCatalog: OverlayMarketItem[];
  loading: boolean;
  onRefresh: () => void;
  onInstall: (id: string) => Promise<void>;
  onCreateCustom: (data: {
    id: string;
    name: string;
    description: string;
    category: "spotify" | "tiktok" | "combined" | "custom";
    width: number;
    height: number;
  }) => Promise<void>;
  onDeleteOverlay: (id: string) => Promise<void>;
  onOpenStudio?: () => void;
}

export const OverlaysTab: React.FC<OverlaysTabProps> = ({
  apiBase,
  installedOverlays,
  marketCatalog,
  loading,
  onRefresh,
  onInstall,
  onCreateCustom,
  onDeleteOverlay,
  onOpenStudio,
}) => {
  const [activeCategory, setActiveCategory] = useState<string>("ALL");
  const [previewOverlay, setPreviewOverlay] = useState<OverlayMeta | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [installingId, setInstallingId] = useState<string | null>(null);
  const [openingFolder, setOpeningFolder] = useState<string | null>(null);

  const os = useMemo(() => detectOS(), []);
  const osFolderLabel = os === "mac" ? "FINDER" : os === "windows" ? "EXPLORER" : "FOLDER";

  async function handleOpenFolder(id?: string) {
    const key = id || "root";
    setOpeningFolder(key);
    try {
      // 1. Try desktop Tauri opener plugin if running in Tauri app
      try {
        const { openPath } = await import("@tauri-apps/plugin-opener");
        const res = await fetch(`${apiBase}/api/overlays/open-folder`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(id ? { id } : {}),
        });
        const data = await res.json();
        if (data.path) {
          await openPath(data.path);
          return;
        }
      } catch {}

      // 2. Direct server endpoint execution fallback
      await fetch(`${apiBase}/api/overlays/open-folder`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(id ? { id } : {}),
      });
    } catch (err) {
      console.error("Failed to open folder:", err);
    } finally {
      setTimeout(() => setOpeningFolder(null), 800);
    }
  }

  // Form state for creating custom overlay
  const [customName, setCustomName] = useState("");
  const [customId, setCustomId] = useState("");
  const [customDesc, setCustomDesc] = useState("");
  const [customCategory, setCustomCategory] = useState<"spotify" | "tiktok" | "combined" | "custom">("custom");
  const [customWidth, setCustomWidth] = useState(480);
  const [customHeight, setCustomHeight] = useState(160);
  const [creating, setCreating] = useState(false);

  // Form state for pulling overlay from Git / zip
  const [showGitModal, setShowGitModal] = useState(false);
  const [gitUrl, setGitUrl] = useState("");
  const [gitOverlayId, setGitOverlayId] = useState("");
  const [idManuallyEdited, setIdManuallyEdited] = useState(false);
  const [pullingGit, setPullingGit] = useState(false);
  const [gitPullError, setGitPullError] = useState<string | null>(null);
  const [gitPullSuccess, setGitPullSuccess] = useState<string | null>(null);
  const [systemHasGit, setSystemHasGit] = useState<boolean | null>(null);

  const checkGitStatus = async () => {
    try {
      const res = await fetch(`${apiBase}/api/overlays/git-status`);
      if (res.ok) {
        const data = await res.json();
        setSystemHasGit(Boolean(data.hasGit));
      }
    } catch {}
  };

  async function handlePullGitSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!gitUrl.trim()) return;

    setPullingGit(true);
    setGitPullError(null);
    setGitPullSuccess(null);

    const finalId = gitOverlayId.trim() || extractRepoName(gitUrl) || undefined;

    try {
      const res = await fetch(`${apiBase}/api/overlays/pull-git`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          url: gitUrl.trim(),
          id: finalId,
        }),
      });

      const data = await res.json();
      if (data.success) {
        const methodMsg =
          data.method === "git_clone"
            ? "Cloned via Git (shallow clone)"
            : "Downloaded & extracted via ZIP archive";
        setGitPullSuccess(`Installed "${data.overlay?.name || "overlay"}" successfully! (${methodMsg})`);
        setGitUrl("");
        setGitOverlayId("");
        setIdManuallyEdited(false);
        await onRefresh();
        setTimeout(() => {
          setShowGitModal(false);
          setGitPullSuccess(null);
        }, 1500);
      } else {
        setGitPullError(data.error || "Failed to pull overlay");
      }
    } catch (err: any) {
      setGitPullError(`Network error: ${err.message}`);
    } finally {
      setPullingGit(false);
    }
  }

  // Combine market catalog with custom installed overlays not present in market
  const installedMap = new Map(installedOverlays.map((o) => [o.id, o]));

  const allItems: OverlayMarketItem[] = [
    ...marketCatalog.map((item) => ({
      ...item,
      isInstalled: installedMap.has(item.id),
    })),
    ...installedOverlays
      .filter((o) => !marketCatalog.some((m) => m.id === o.id))
      .map((o) => ({
        ...o,
        isInstalled: true,
        tags: ["CUSTOM", o.category.toUpperCase()],
      })),
  ];

  const filteredItems = allItems.filter((item) => {
    if (activeCategory === "ALL") return true;
    return item.category.toUpperCase() === activeCategory;
  });

  function getObsUrl(id: string): string {
    return `${apiBase}/overlays/${id}/`;
  }

  async function handleCopyUrl(id: string) {
    const url = getObsUrl(id);
    try {
      await navigator.clipboard.writeText(url);
      setCopiedId(id);
      setTimeout(() => setCopiedId(null), 2000);
    } catch {
      prompt("Copy OBS Browser Source URL:", url);
    }
  }

  async function handleInstallClick(id: string) {
    setInstallingId(id);
    try {
      await onInstall(id);
    } finally {
      setInstallingId(null);
    }
  }

  async function handleCreateSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!customName.trim()) return;
    setCreating(true);
    try {
      await onCreateCustom({
        id: customId.trim() || customName.toLowerCase().replace(/[^a-z0-9]/g, "-"),
        name: customName.trim(),
        description: customDesc.trim(),
        category: customCategory,
        width: Number(customWidth) || 480,
        height: Number(customHeight) || 160,
      });
      setShowCreateModal(false);
      setCustomName("");
      setCustomId("");
      setCustomDesc("");
    } finally {
      setCreating(false);
    }
  }

  return (
    <>
      {/* Header Card */}
      <section className="raw-card elevated">
        <div className="card-title">
          <div>
            <h2>STREAM OVERLAYS &amp; MARKETPLACE</h2>
            <span className="mono-font" style={{ fontSize: "12px", color: "var(--ctp-subtext0)" }}>
              OBS / STREAMLABS BROWSER SOURCES
            </span>
          </div>
          <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
            {onOpenStudio && (
              <button
                type="button"
                className="btn btn-primary"
                style={{ padding: "4px 12px", fontSize: "11px" }}
                onClick={onOpenStudio}
              >
                🎛 OPEN STUDIO COMPOSER
              </button>
            )}
            <button
              type="button"
              className="btn btn-secondary"
              style={{ padding: "4px 10px", fontSize: "11px" }}
              onClick={() => handleOpenFolder()}
              disabled={openingFolder === "root"}
              title={`Open overlays folder in ${os === "mac" ? "macOS Finder" : os === "windows" ? "Windows File Explorer" : "Linux File Manager"}`}
            >
              📁 {openingFolder === "root" ? "OPENING..." : `OPEN IN ${osFolderLabel}`}
            </button>
            <button
              type="button"
              className="btn btn-secondary"
              style={{ padding: "4px 10px", fontSize: "11px" }}
              onClick={() => {
                setShowGitModal(true);
                setIdManuallyEdited(false);
                checkGitStatus();
              }}
              title="Pull or clone an overlay from a Git repository or zip archive"
            >
              📥 PULL FROM GIT
            </button>
            <button
              type="button"
              className="btn btn-secondary"
              style={{ padding: "4px 10px", fontSize: "11px" }}
              onClick={onRefresh}
              disabled={loading}
            >
              {loading ? "REFRESHING..." : "🔄 REFRESH"}
            </button>
            <button
              type="button"
              className="btn btn-primary"
              style={{ padding: "4px 12px", fontSize: "11px" }}
              onClick={() => setShowCreateModal(true)}
            >
              + NEW OVERLAY
            </button>
          </div>
        </div>

        <p style={{ fontSize: "13px", color: "var(--ctp-subtext0)", lineHeight: "1.6" }}>
          All overlays are statically served from your local desktop bridge at{" "}
          <code className="mono-font" style={{ color: "var(--accent-primary)", background: "var(--ctp-crust)", padding: "2px 6px" }}>
            http://127.0.0.1:3001/overlays/&lt;id&gt;/
          </code>
          . Add any overlay as a <strong>Browser Source</strong> in OBS, set its width and height, and check <strong>Shutdown source when not visible</strong>. Overlays automatically receive live stream and music events via SSE.
        </p>

        {/* Filter Navigation */}
        <div className="overlay-filter-row">
          {["ALL", "SPOTIFY", "TIKTOK", "COMBINED", "CUSTOM"].map((cat) => (
            <button
              key={cat}
              type="button"
              className={`filter-btn ${activeCategory === cat ? "active" : ""}`}
              onClick={() => setActiveCategory(cat)}
            >
              {cat}
            </button>
          ))}
          <span className="mono-font" style={{ marginLeft: "auto", fontSize: "11px", color: "var(--ctp-subtext0)", alignSelf: "center" }}>
            {filteredItems.length} ITEMS AVAILABLE
          </span>
        </div>
      </section>

      {/* Overlays Grid */}
      <div className="overlay-grid">
        {filteredItems.map((item) => {
          const obsUrl = getObsUrl(item.id);
          const isCopied = copiedId === item.id;
          const isInstalling = installingId === item.id;

          return (
            <div key={item.id} className={`overlay-card ${item.isInstalled ? "installed" : ""}`}>
              <div className="overlay-card-header">
                <div style={{ display: "flex", gap: "6px", alignItems: "center" }}>
                  <span className={`overlay-category-tag ${item.category}`}>
                    {item.category.toUpperCase()}
                  </span>
                  {item.isInstalled && (
                    <span className="overlay-installed-badge">✓ INSTALLED</span>
                  )}
                  {item.isCustom && (
                    <span className="overlay-custom-badge">CUSTOM</span>
                  )}
                </div>
                <span className="overlay-dimensions">
                  {item.width} × {item.height} PX
                </span>
              </div>

              <div className="overlay-card-body">
                <h3 className="overlay-title">{item.name}</h3>
                <p className="overlay-desc">{item.description}</p>

                {/* Tags */}
                {item.tags && item.tags.length > 0 && (
                  <div className="overlay-tags">
                    {item.tags.map((tag) => (
                      <span key={tag} className="tag-chip">
                        #{tag}
                      </span>
                    ))}
                  </div>
                )}

                {/* OBS URL Box */}
                <div className="obs-url-box">
                  <span className="obs-url-text">{obsUrl}</span>
                  <button
                    type="button"
                    className={`copy-obs-btn ${isCopied ? "copied" : ""}`}
                    onClick={() => handleCopyUrl(item.id)}
                    title="Copy OBS Browser Source URL"
                  >
                    {isCopied ? "✓ COPIED" : "COPY URL"}
                  </button>
                </div>
              </div>

              {/* Action Buttons */}
              <div className="overlay-card-actions">
                <button
                  type="button"
                  className="btn btn-secondary"
                  style={{ flex: 1, padding: "6px 8px", fontSize: "11px" }}
                  onClick={() => setPreviewOverlay(item)}
                >
                  👁 LIVE PREVIEW
                </button>

                {item.isInstalled && (
                  <button
                    type="button"
                    className="btn btn-secondary"
                    style={{ padding: "6px 10px", fontSize: "11px" }}
                    onClick={() => handleOpenFolder(item.id)}
                    disabled={openingFolder === item.id}
                    title={`Open this overlay in ${os === "mac" ? "Finder" : os === "windows" ? "File Explorer" : "File Manager"}`}
                  >
                    📁 {openingFolder === item.id ? "..." : "FOLDER"}
                  </button>
                )}

                {!item.isCustom && (
                  <button
                    type="button"
                    className="btn btn-primary"
                    style={{ flex: 1, padding: "6px 8px", fontSize: "11px" }}
                    onClick={() => handleInstallClick(item.id)}
                    disabled={isInstalling}
                  >
                    {isInstalling ? "SAVING..." : item.isInstalled ? "REINSTALL" : "INSTALL"}
                  </button>
                )}

                {item.isCustom && (
                  <button
                    type="button"
                    className="btn btn-destructive"
                    style={{ padding: "6px 10px", fontSize: "11px" }}
                    onClick={() => onDeleteOverlay(item.id)}
                    title="Delete custom overlay"
                  >
                    DELETE
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Live Preview Modal */}
      {previewOverlay && (
        <div className="modal-backdrop" onClick={() => setPreviewOverlay(null)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <div>
                <h3>LIVE PREVIEW: {previewOverlay.name}</h3>
                <span className="mono-font" style={{ fontSize: "11px", color: "var(--ctp-subtext0)" }}>
                  {previewOverlay.width} × {previewOverlay.height} PX // OBS BROWSER SOURCE
                </span>
              </div>
              <button
                type="button"
                className="btn btn-secondary"
                style={{ padding: "2px 8px", fontSize: "12px" }}
                onClick={() => setPreviewOverlay(null)}
              >
                ✕ CLOSE
              </button>
            </div>

            <div className="modal-body">
              <div className="preview-checkerboard">
                <iframe
                  src={`${apiBase}/overlays/${previewOverlay.id}/`}
                  title={previewOverlay.name}
                  style={{
                    width: `${previewOverlay.width}px`,
                    height: `${previewOverlay.height}px`,
                    border: "none",
                    background: "transparent",
                  }}
                />
              </div>

              <div style={{ marginTop: "14px", display: "flex", gap: "10px", alignItems: "center" }}>
                <input
                  type="text"
                  className="raw-input"
                  style={{ flex: 1, fontSize: "12px", padding: "6px 10px" }}
                  readOnly
                  value={getObsUrl(previewOverlay.id)}
                />
                <button
                  type="button"
                  className="btn btn-primary"
                  style={{ padding: "6px 14px", fontSize: "11px" }}
                  onClick={() => handleCopyUrl(previewOverlay.id)}
                >
                  {copiedId === previewOverlay.id ? "✓ COPIED" : "COPY OBS URL"}
                </button>
                <a
                  href={`${apiBase}/overlays/${previewOverlay.id}/`}
                  target="_blank"
                  rel="noreferrer"
                  className="btn btn-secondary"
                  style={{ padding: "6px 14px", fontSize: "11px", textDecoration: "none" }}
                >
                  OPEN TAB ↗
                </a>
                <button
                  type="button"
                  className="btn btn-secondary"
                  style={{ padding: "6px 14px", fontSize: "11px" }}
                  onClick={() => handleOpenFolder(previewOverlay.id)}
                  title={`Open this overlay in ${os === "mac" ? "Finder" : os === "windows" ? "File Explorer" : "File Manager"}`}
                >
                  📁 {osFolderLabel}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Create Custom Overlay Modal */}
      {showCreateModal && (
        <div className="modal-backdrop" onClick={() => setShowCreateModal(false)}>
          <div className="modal-content small" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>CREATE CUSTOM OVERLAY</h3>
              <button
                type="button"
                className="btn btn-secondary"
                style={{ padding: "2px 8px", fontSize: "12px" }}
                onClick={() => setShowCreateModal(false)}
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleCreateSubmit} className="modal-body form-grid">
              <div className="form-group">
                <label className="form-label">OVERLAY NAME</label>
                <input
                  type="text"
                  className="raw-input"
                  placeholder="e.g. Neon Song Bar"
                  value={customName}
                  onChange={(e) => setCustomName(e.target.value)}
                  required
                />
              </div>

              <div className="form-group">
                <label className="form-label">FOLDER ID (OPTIONAL)</label>
                <input
                  type="text"
                  className="raw-input"
                  placeholder="e.g. neon-song-bar"
                  value={customId}
                  onChange={(e) => setCustomId(e.target.value)}
                />
              </div>

              <div className="form-group">
                <label className="form-label">DESCRIPTION</label>
                <input
                  type="text"
                  className="raw-input"
                  placeholder="Short description of this stream overlay"
                  value={customDesc}
                  onChange={(e) => setCustomDesc(e.target.value)}
                />
              </div>

              <div className="form-group">
                <label className="form-label">CATEGORY</label>
                <select
                  className="raw-input"
                  value={customCategory}
                  onChange={(e) => setCustomCategory(e.target.value as any)}
                >
                  <option value="spotify">SPOTIFY</option>
                  <option value="tiktok">TIKTOK</option>
                  <option value="combined">COMBINED</option>
                  <option value="custom">CUSTOM</option>
                </select>
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px" }}>
                <div className="form-group">
                  <label className="form-label">WIDTH (PX)</label>
                  <input
                    type="number"
                    className="raw-input"
                    value={customWidth}
                    onChange={(e) => setCustomWidth(Number(e.target.value))}
                    min={50}
                    max={3840}
                  />
                </div>
                <div className="form-group">
                  <label className="form-label">HEIGHT (PX)</label>
                  <input
                    type="number"
                    className="raw-input"
                    value={customHeight}
                    onChange={(e) => setCustomHeight(Number(e.target.value))}
                    min={20}
                    max={2160}
                  />
                </div>
              </div>

              <div className="btn-row" style={{ marginTop: "12px" }}>
                <button
                  type="submit"
                  className="btn btn-primary"
                  disabled={creating || !customName.trim()}
                >
                  {creating ? "SCAFFOLDING..." : "CREATE OVERLAY"}
                </button>
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => setShowCreateModal(false)}
                >
                  CANCEL
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Pull Overlay from Git / Zip Modal */}
      {showGitModal && (
        <div className="modal-backdrop" onClick={() => !pullingGit && setShowGitModal(false)}>
          <div className="modal-content small" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
                <h3>PULL OVERLAY FROM GIT</h3>
                {systemHasGit !== null && (
                  <span
                    className="tag-chip"
                    style={{
                      fontSize: "10px",
                      background: systemHasGit ? "var(--status-success)" : "var(--ctp-peach)",
                      color: "var(--ctp-crust)",
                      fontWeight: "bold",
                    }}
                  >
                    {systemHasGit ? "⚡ GIT AVAILABLE (CLONE)" : "📦 NO GIT (ZIP EXTRACT)"}
                  </span>
                )}
              </div>
              <button
                type="button"
                className="btn btn-secondary"
                style={{ padding: "2px 8px", fontSize: "12px" }}
                onClick={() => !pullingGit && setShowGitModal(false)}
                disabled={pullingGit}
              >
                ✕
              </button>
            </div>

            <form onSubmit={handlePullGitSubmit} className="modal-body form-grid">
              <p style={{ fontSize: "12px", color: "var(--ctp-subtext0)", lineHeight: "1.5" }}>
                Enter a Git repository URL (GitHub, GitLab, etc.) or a direct zip URL. If Git is detected on your machine, it performs a fast shallow clone; if not, it automatically downloads and extracts the repository ZIP archive.
              </p>

              {gitPullError && (
                <div className="alert-banner" style={{ padding: "8px 12px", fontSize: "12px" }}>
                  <span>[!]</span>
                  <span>{gitPullError}</span>
                </div>
              )}

              {gitPullSuccess && (
                <div className="alert-banner success" style={{ padding: "8px 12px", fontSize: "12px" }}>
                  <span>[OK]</span>
                  <span>{gitPullSuccess}</span>
                </div>
              )}

              <div className="form-group">
                <label className="form-label">REPOSITORY OR ZIP URL *</label>
                <input
                  type="text"
                  className="raw-input"
                  placeholder="https://github.com/username/overlay-name"
                  value={gitUrl}
                  onChange={(e) => {
                    const val = e.target.value;
                    setGitUrl(val);
                    if (!idManuallyEdited || !gitOverlayId.trim()) {
                      const auto = extractRepoName(val);
                      if (auto) setGitOverlayId(auto);
                    }
                  }}
                  disabled={pullingGit}
                  required
                />
              </div>

              <div className="form-group">
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "4px" }}>
                  <label className="form-label" style={{ marginBottom: 0 }}>OVERLAY ID</label>
                  {idManuallyEdited && (
                    <button
                      type="button"
                      className="btn btn-secondary"
                      style={{ padding: "1px 6px", fontSize: "10px", lineHeight: "14px" }}
                      onClick={() => {
                        setIdManuallyEdited(false);
                        setGitOverlayId(extractRepoName(gitUrl));
                      }}
                      title="Reset to auto-generated ID from repository name"
                    >
                      ↺ AUTO FROM REPO
                    </button>
                  )}
                </div>
                <input
                  type="text"
                  className="raw-input"
                  placeholder={extractRepoName(gitUrl) || "auto-detected from repo name"}
                  value={gitOverlayId}
                  onChange={(e) => {
                    setGitOverlayId(e.target.value);
                    setIdManuallyEdited(true);
                  }}
                  disabled={pullingGit}
                />
                <span className="form-helper">
                  Folder name inside your overlays directory (auto-generated from repo name).
                </span>
              </div>

              <div className="btn-row" style={{ marginTop: "12px" }}>
                <button
                  type="submit"
                  className="btn btn-primary"
                  disabled={pullingGit || !gitUrl.trim()}
                >
                  {pullingGit
                    ? systemHasGit
                      ? "CLONING REPOSITORY..."
                      : "DOWNLOADING & EXTRACTING ZIP..."
                    : "📥 PULL & INSTALL"}
                </button>
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => setShowGitModal(false)}
                  disabled={pullingGit}
                >
                  CANCEL
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
};
