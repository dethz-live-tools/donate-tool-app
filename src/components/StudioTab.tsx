import React, { useEffect, useRef, useState } from "react";
import { OverlayMeta, StudioLayer, StudioScene } from "../types";
import { useLang } from "../i18n.tsx";

interface StudioTabProps {
  apiBase: string;
  installedOverlays: OverlayMeta[];
  studio: StudioScene;
  onSaveStudio: (scene: StudioScene) => Promise<void>;
  onGoToMarket: () => void;
}

const PRESET_SIZES: Array<{ label: string; width: number; height: number }> = [
  { label: "1080P LANDSCAPE (1920×1080)", width: 1920, height: 1080 },
  { label: "720P LANDSCAPE (1280×720)", width: 1280, height: 720 },
  { label: "TIKTOK VERTICAL (1080×1920)", width: 1080, height: 1920 },
];

interface StudioProfile {
  id: string;
  name: string;
  scene: StudioScene;
}

type DragMode = "move" | "resize";

interface DragState {
  mode: DragMode;
  layerId: string;
  startClientX: number;
  startClientY: number;
  origX: number;
  origY: number;
  origW: number;
  origH: number;
}

export const StudioTab: React.FC<StudioTabProps> = ({
  apiBase,
  installedOverlays,
  studio,
  onSaveStudio,
  onGoToMarket,
}) => {
  const { t } = useLang();
  const [scene, setScene] = useState<StudioScene>(studio);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [profiles, setProfiles] = useState<StudioProfile[]>([]);
  const [profileId, setProfileId] = useState("");
  const [profileToLoad, setProfileToLoad] = useState("");
  const [profileName, setProfileName] = useState("");
  const [profileUrl, setProfileUrl] = useState("");
  const [profilesError, setProfilesError] = useState("");
  const [externalUrl, setExternalUrl] = useState("");
  const [externalName, setExternalName] = useState("");
  const [externalError, setExternalError] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [snapGrid, setSnapGrid] = useState<boolean>(true);
  const [showTikTokGuides, setShowTikTokGuides] = useState(false);
  const [saving, setSaving] = useState<boolean>(false);
  const [copied, setCopied] = useState<boolean>(false);
  const [expanded, setExpanded] = useState(false);
  const [previewExpanded, setPreviewExpanded] = useState(false);
  const [viewport, setViewport] = useState({ width: 760, height: 520 });

  const stageWrapRef = useRef<HTMLDivElement | null>(null);
  const stageOuterRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<DragState | null>(null);
  const sceneRef = useRef<StudioScene>(scene);
  const masterRef = useRef(studio);
  const onSaveStudioRef = useRef(onSaveStudio);
  const selectionRef = useRef({ id: "" });
  const mountedRef = useRef(true);
  const busyRef = useRef(false);
  const dirtyRef = useRef(false);
  const saveTimerRef = useRef<number | undefined>(undefined);
  const copyTimerRef = useRef<number | undefined>(undefined);
  const pendingSaveRef = useRef<StudioScene | null>(null);
  const saveChainRef = useRef<Promise<boolean>>(Promise.resolve(true));
  const saveSequenceRef = useRef(0);
  const editVersionRef = useRef(0);
  const profilesVersionRef = useRef(0);
  const requestRef = useRef<AbortController | null>(null);
  const saveRequestRef = useRef<AbortController | null>(null);
  sceneRef.current = scene;
  masterRef.current = studio;
  onSaveStudioRef.current = onSaveStudio;

  useEffect(() => {
    mountedRef.current = true;
    const controller = new AbortController();
    const profilesVersion = profilesVersionRef.current;
    void (async () => {
      try {
        const response = await fetch(`${apiBase}/api/overlays/studio/profiles`, { signal: controller.signal });
        const data = await response.json();
        if (!response.ok || !data.success || !Array.isArray(data.profiles)) {
          throw new Error(data.error || t("Could not load profiles ({status})", { status: response.status }));
        }
        if (!controller.signal.aborted && profilesVersion === profilesVersionRef.current) {
          setProfiles(data.profiles);
          const requestedId = new URLSearchParams(window.location.search).get("profile");
          if (requestedId) await changeProfile(requestedId);
        }
      } catch (err) {
        if (!controller.signal.aborted && profilesVersion === profilesVersionRef.current) setProfilesError(err instanceof Error ? err.message : t("Could not load profiles"));
      }
    })();
    return () => {
      mountedRef.current = false;
      selectionRef.current = { id: selectionRef.current.id };
      window.clearTimeout(saveTimerRef.current);
      window.clearTimeout(copyTimerRef.current);
      pendingSaveRef.current = null;
      dragRef.current = null;
      controller.abort();
      requestRef.current?.abort();
      saveRequestRef.current?.abort();
    };
  }, [apiBase]);

  useEffect(() => {
    if (!selectionRef.current.id && !dragRef.current && !dirtyRef.current && !busyRef.current) {
      sceneRef.current = studio;
      setScene(studio);
    }
  }, [studio]);

  useEffect(() => {
    const el = stageWrapRef.current;
    if (!el) return;
    const updateSize = () => {
      const rect = el.getBoundingClientRect();
      const top = stageOuterRef.current?.getBoundingClientRect().top ?? rect.top;
      setViewport({
        width: Math.max(1, Math.floor(rect.width - 28)),
        height: Math.max(1, Math.floor((window.visualViewport?.height ?? window.innerHeight) - top - 30)),
      });
    };
    updateSize();
    const ro = new ResizeObserver(updateSize);
    ro.observe(el);
    window.addEventListener("resize", updateSize);
    window.visualViewport?.addEventListener("resize", updateSize);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", updateSize);
      window.visualViewport?.removeEventListener("resize", updateSize);
    };
  }, [expanded, previewExpanded]);

  useEffect(() => {
    const restore = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setExpanded(false);
        setPreviewExpanded(false);
      }
    };
    window.addEventListener("keydown", restore);
    return () => window.removeEventListener("keydown", restore);
  }, []);

  const isExpanded = expanded || previewExpanded;
  const maxStageHeight = isExpanded ? viewport.height : scene.height > scene.width ? 680 : 520;
  const previewScale = Math.min(
    1,
    viewport.width / Math.max(1, scene.width),
    maxStageHeight / Math.max(1, scene.height)
  );

  function persistScene(next: StudioScene) {
    const selection = selectionRef.current;
    const sequence = ++saveSequenceRef.current;
    const editVersion = editVersionRef.current;
    const result = saveChainRef.current.then(async () => {
      if (!mountedRef.current || selectionRef.current !== selection) return false;
      setSaving(true);
      setError("");
      try {
        if (selection.id) {
          const controller = new AbortController();
          saveRequestRef.current = controller;
          const response = await fetch(`${apiBase}/api/overlays/studio?profile=${encodeURIComponent(selection.id)}`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ studio: next }),
            signal: controller.signal,
          });
          const data = await response.json();
          if (!response.ok || !data.success) throw new Error(data.error || t("Could not save profile ({status})", { status: response.status }));
        } else {
          await onSaveStudioRef.current(next);
        }
        if (mountedRef.current && selectionRef.current === selection && sequence === saveSequenceRef.current && editVersion === editVersionRef.current && !pendingSaveRef.current) {
          dirtyRef.current = false;
        }
        return true;
      } catch (err) {
        if (mountedRef.current && selectionRef.current === selection) {
          setError(err instanceof Error ? err.message : t("Could not save scene"));
        }
        return false;
      } finally {
        if (mountedRef.current && selectionRef.current === selection && sequence === saveSequenceRef.current) {
          setSaving(Boolean(pendingSaveRef.current));
        }
      }
    });
    saveChainRef.current = result;
    return result;
  }

  function scheduleSave(next: StudioScene) {
    if (busyRef.current) return;
    sceneRef.current = next;
    setScene(next);
    dirtyRef.current = true;
    editVersionRef.current++;
    pendingSaveRef.current = next;
    setSaving(true);
    window.clearTimeout(saveTimerRef.current);
    saveTimerRef.current = window.setTimeout(() => {
      pendingSaveRef.current = null;
      void persistScene(next);
    }, 280);
  }

  function saveImmediate(next: StudioScene) {
    if (busyRef.current) return Promise.resolve(false);
    window.clearTimeout(saveTimerRef.current);
    pendingSaveRef.current = null;
    sceneRef.current = next;
    setScene(next);
    dirtyRef.current = true;
    editVersionRef.current++;
    return persistScene(next);
  }

  async function changeProfile(id: string, create = false) {
    if (busyRef.current || (create && !profileName.trim())) return;
    busyRef.current = true;
    setBusy(true);
    setError("");
    dragRef.current = null;
    window.clearTimeout(saveTimerRef.current);
    const pending = pendingSaveRef.current;
    pendingSaveRef.current = null;
    const controller = new AbortController();
    requestRef.current?.abort();
    requestRef.current = controller;
    try {
      if (pending) {
        if (!await persistScene(pending)) return;
      } else {
        await saveChainRef.current;
      }
      if (dirtyRef.current && !await persistScene(sceneRef.current)) return;
      if (!mountedRef.current || controller.signal.aborted) return;
      let next = masterRef.current;
      let nextId = id;
      if (create || id) {
        const response = await fetch(create
          ? `${apiBase}/api/overlays/studio/profiles`
          : `${apiBase}/api/overlays/studio?profile=${encodeURIComponent(id)}`, {
          ...(create ? {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ name: profileName.trim(), scene: sceneRef.current }),
          } : {}),
          signal: controller.signal,
        });
        const data = await response.json();
        if (!response.ok || !data.success || (create ? !data.profile?.id || !data.profile.scene || !Array.isArray(data.profiles) : !data.studio)) {
          throw new Error(data.error || t(create ? "Could not create profile ({status})" : "Could not load profiles ({status})", { status: response.status }));
        }
        if (!mountedRef.current || controller.signal.aborted) return;
        next = create ? data.profile.scene : data.studio;
        if (create) {
          nextId = data.profile.id;
          profilesVersionRef.current++;
          setProfiles(data.profiles);
          setProfilesError("");
          setProfileName("");
        }
      }
      selectionRef.current = { id: nextId };
      setProfileId(nextId);
      setProfileToLoad(nextId);
      const editorUrl = new URL(window.location.href);
      editorUrl.searchParams.set("page", "studio");
      if (nextId) editorUrl.searchParams.set("profile", nextId);
      else editorUrl.searchParams.delete("profile");
      window.history.replaceState(null, "", editorUrl);
      sceneRef.current = next;
      setScene(next);
      setSelectedId(null);
      setCopied(false);
      dirtyRef.current = false;
      setSaving(false);
    } catch (err) {
      if (mountedRef.current && !controller.signal.aborted) setError(err instanceof Error ? err.message : t("Could not change profile"));
    } finally {
      if (mountedRef.current && !controller.signal.aborted) {
        busyRef.current = false;
        setBusy(false);
      }
    }
  }

  function snap(val: number): number {
    return snapGrid ? Math.round(val / 10) * 10 : Math.round(val);
  }

  useEffect(() => {
    function onPointerMove(e: PointerEvent) {
      const d = dragRef.current;
      if (!d) return;
      const dx = (e.clientX - d.startClientX) / previewScale;
      const dy = (e.clientY - d.startClientY) / previewScale;

      const cur = sceneRef.current;
      const nextLayers = cur.layers.map((l) => {
        if (l.id !== d.layerId) return l;
        if (d.mode === "move") {
          return {
            ...l,
            x: snap(d.origX + dx),
            y: snap(d.origY + dy),
          };
        }
        return {
          ...l,
          width: Math.max(60, snap(d.origW + dx)),
          height: Math.max(30, snap(d.origH + dy)),
        };
      });
      dirtyRef.current = true;
      editVersionRef.current++;
      sceneRef.current = { ...cur, layers: nextLayers };
      setScene(sceneRef.current);
    }

    function onPointerUp() {
      if (!dragRef.current) return;
      dragRef.current = null;
      void saveImmediate(sceneRef.current);
    }

    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
    return () => {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
    };
  }, [previewScale, snapGrid]);

  function startDrag(e: React.PointerEvent, layer: StudioLayer, mode: DragMode) {
    e.stopPropagation();
    e.preventDefault();
    if (busyRef.current) return;
    setSelectedId(layer.id);
    if (layer.locked) return;
    dragRef.current = {
      mode,
      layerId: layer.id,
      startClientX: e.clientX,
      startClientY: e.clientY,
      origX: layer.x,
      origY: layer.y,
      origW: layer.width,
      origH: layer.height,
    };
  }

  function handleAddLayer(overlay: Pick<OverlayMeta, "id" | "name" | "width" | "height">, url?: string) {
    const maxZ = scene.layers.reduce((m, l) => Math.max(m, l.zIndex), 0);
    const offset = (scene.layers.length % 6) * 30;
    const newLayer: StudioLayer = {
      id: `layer-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      overlayId: overlay.id,
      ...(url ? { url } : {}),
      name: overlay.name,
      x: snap(40 + offset),
      y: snap(40 + offset),
      width: overlay.width || 480,
      height: overlay.height || 160,
      scale: 1,
      opacity: 1,
      zIndex: maxZ + 1,
      visible: true,
      locked: false,
    };
    const next: StudioScene = {
      ...scene,
      layers: [...scene.layers, newLayer],
    };
    setSelectedId(newLayer.id);
    void saveImmediate(next);
  }

  function handleAddExternalLayer(event: React.FormEvent) {
    event.preventDefault();
    if (busyRef.current) return;
    try {
      const input = externalUrl.trim();
      if (!/^https?:\/\//i.test(input)) throw new Error(t("Enter an absolute HTTP or HTTPS URL."));
      const url = new URL(input);
      if ((url.protocol !== "http:" && url.protocol !== "https:") || url.username || url.password) {
        throw new Error(t("Use an HTTP or HTTPS URL without a username or password."));
      }
      const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
      if (
        host === "169.254.169.254" ||
        host === "169.254.169.253" ||
        host.startsWith("169.254.") ||
        host === "metadata.google.internal" ||
        host === "fd00:ec2::254" ||
        host.startsWith("fe80:") ||
        host.startsWith("::ffff:a9fe:") ||
        host.startsWith("::ffff:169.254.")
      ) {
        throw new Error(t("Targeting cloud metadata services is forbidden."));
      }
      const port = url.port ? Number(url.port) : (url.protocol === "https:" ? 443 : 80);
      const isLoopback =
        host === "localhost" ||
        host === "127.0.0.1" ||
        host === "0.0.0.0" ||
        host === "::1" ||
        host === "::" ||
        host.startsWith("127.") ||
        host.startsWith("::ffff:7f") ||
        host.startsWith("::ffff:127.") ||
        host === "::ffff:0:0" ||
        host === "::ffff:0.0.0.0";
      if (isLoopback && (port === 3001 || port === Number(window.location.port))) {
        throw new Error(t("External layer cannot target the application's own API port."));
      }
      handleAddLayer({ id: "", name: externalName.trim() || url.hostname, width: 480, height: 160 }, url.href);
      setExternalUrl("");
      setExternalName("");
      setExternalError("");
    } catch (err) {
      setExternalError(err instanceof Error ? err.message : t("Invalid external overlay URL."));
    }
  }

  function updateLayer(id: string, patch: Partial<StudioLayer>) {
    const next: StudioScene = {
      ...scene,
      layers: scene.layers.map((l) => (l.id === id ? { ...l, ...patch } : l)),
    };
    scheduleSave(next);
  }

  function handleRemoveLayer(id: string) {
    const next: StudioScene = {
      ...scene,
      layers: scene.layers.filter((l) => l.id !== id),
    };
    if (selectedId === id) setSelectedId(null);
    void saveImmediate(next);
  }

  function handleShiftZ(id: string, dir: "up" | "down") {
    const sorted = [...scene.layers].sort((a, b) => a.zIndex - b.zIndex);
    const idx = sorted.findIndex((l) => l.id === id);
    if (idx === -1) return;
    const swapIdx = dir === "up" ? idx + 1 : idx - 1;
    if (swapIdx < 0 || swapIdx >= sorted.length) return;
    const temp = sorted[idx];
    sorted[idx] = sorted[swapIdx];
    sorted[swapIdx] = temp;
    const normalized = sorted.map((l, i) => ({ ...l, zIndex: i + 1 }));
    void saveImmediate({ ...scene, layers: normalized });
  }

  function alignSelected(pos: "tl" | "tr" | "bl" | "br" | "center") {
    if (!selectedLayer) return;
    const effW = selectedLayer.width * selectedLayer.scale;
    const effH = selectedLayer.height * selectedLayer.scale;
    const pad = 20;
    let x = selectedLayer.x;
    let y = selectedLayer.y;
    if (pos === "tl") {
      x = pad;
      y = pad;
    } else if (pos === "tr") {
      x = Math.round(scene.width - effW - pad);
      y = pad;
    } else if (pos === "bl") {
      x = pad;
      y = Math.round(scene.height - effH - pad);
    } else if (pos === "br") {
      x = Math.round(scene.width - effW - pad);
      y = Math.round(scene.height - effH - pad);
    } else if (pos === "center") {
      x = Math.round((scene.width - effW) / 2);
      y = Math.round((scene.height - effH) / 2);
    }
    updateLayer(selectedLayer.id, { x, y });
  }

  const obsStudioUrl = `${apiBase}/overlays/studio/${profileId ? `?profile=${encodeURIComponent(profileId)}` : ""}`;
  const editorStudioUrl = new URL(window.location.href);
  editorStudioUrl.searchParams.set("page", "studio");
  if (profileId) editorStudioUrl.searchParams.set("profile", profileId);
  else editorStudioUrl.searchParams.delete("profile");

  function loadProfileUrl(event: React.FormEvent) {
    event.preventDefault();
    try {
      const url = new URL(profileUrl.trim(), window.location.href);
      if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error(t("Use an HTTP or HTTPS Studio link."));
      const id = url.searchParams.get("profile");
      if (!id) throw new Error(t("Studio link must include ?profile=<id>."));
      void changeProfile(id);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("Invalid Studio link."));
    }
  }

  async function handleCopyObsUrl() {
    const selection = selectionRef.current;
    try {
      await navigator.clipboard.writeText(obsStudioUrl);
      if (!mountedRef.current || selectionRef.current !== selection) return;
      setCopied(true);
      window.clearTimeout(copyTimerRef.current);
      copyTimerRef.current = window.setTimeout(() => setCopied(false), 2000);
    } catch {
      if (mountedRef.current && selectionRef.current === selection) prompt(t("Copy OBS Studio URL:"), obsStudioUrl);
    }
  }

  const sortedLayers = [...scene.layers].sort((a, b) => b.zIndex - a.zIndex);
  const selectedLayer = scene.layers.find((l) => l.id === selectedId) || null;

  return (
    <div className={`${isExpanded ? "studio-expanded" : ""} ${previewExpanded ? "studio-preview-expanded" : ""}`} style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
      {/* Studio Header & OBS Master URL */}
      <section className="raw-card elevated">
        <div className="card-title">
          <div>
            <h2>{t("OVERLAY STUDIO // SCENE COMPOSER")}</h2>
            <span className="mono-font" style={{ fontSize: "12px", color: "var(--ctp-subtext0)" }}>
              {t("MERGE & ARRANGE MULTIPLE OVERLAYS INTO ONE OBS SCREEN")}
            </span>
          </div>
          <div style={{ display: "flex", gap: "8px", alignItems: "center", flexWrap: "wrap" }}>
            <span className="mono-font" style={{ fontSize: "11px", color: error || profilesError ? "var(--status-error)" : saving || busy ? "var(--status-warning)" : "var(--status-success)" }}>
              {error || profilesError ? t("[ ERROR ]") : busy ? t("[ LOADING... ]") : saving ? t("[ SAVING... ]") : t("[ READY ]")}
            </span>
            <button
              type="button"
              className="btn btn-secondary"
              style={{ padding: "6px 12px", fontSize: "11px" }}
              aria-pressed={isExpanded}
              onClick={() => {
                setExpanded(!isExpanded);
                setPreviewExpanded(false);
              }}
            >
              {isExpanded ? t("RESTORE EDITOR") : t("EXPAND EDITOR")}
            </button>
            <a
              href={obsStudioUrl}
              target="_blank"
              rel="noreferrer"
              className="btn btn-secondary"
              style={{ padding: "6px 12px", fontSize: "11px", textDecoration: "none" }}
            >
              {t("↗ OPEN OBS VIEW")}
            </a>
            <button
              type="button"
              className="btn btn-primary"
              style={{ padding: "6px 14px", fontSize: "11px" }}
              onClick={handleCopyObsUrl}
            >
              {copied ? t("✓ COPIED URL") : t("COPY OBS STUDIO URL")}
            </button>
          </div>
        </div>

        <form
          style={{ display: "flex", gap: "8px", flexWrap: "wrap", alignItems: "center", marginTop: "12px" }}
          onSubmit={(event) => {
            event.preventDefault();
            void changeProfile("", true);
          }}
        >
          <label className="mono-font" style={{ fontSize: "11px" }}>
            {t("PROFILE:")}{" "}
            <select
              className="raw-input"
              value={profileToLoad}
              disabled={busy}
              onChange={(event) => setProfileToLoad(event.target.value)}
            >
              <option value="">{t("MASTER STUDIO")}</option>
              {profiles.map((profile) => <option key={profile.id} value={profile.id}>{profile.name}</option>)}
            </select>
          </label>
          <button type="button" className="btn btn-secondary" disabled={busy} onClick={() => void changeProfile(profileToLoad)}>
            {t("LOAD PROFILE")}
          </button>
          <input
            className="raw-input"
            aria-label={t("New profile name")}
            placeholder={t("New profile name")}
            value={profileName}
            maxLength={100}
            disabled={busy}
            onChange={(event) => setProfileName(event.target.value)}
          />
          <button type="submit" className="btn btn-secondary" disabled={busy || !profileName.trim()}>
            {t("SAVE AS NEW PROFILE")}
          </button>
          {error && dirtyRef.current && <button type="button" className="btn btn-secondary" disabled={busy} onClick={() => void saveImmediate(sceneRef.current)}>{t("RETRY SAVE")}</button>}
        </form>
        {(error || profilesError) && (
          <p role="alert" className="mono-font" style={{ color: "var(--status-error)", fontSize: "12px", marginTop: "10px" }}>
            {[error, profilesError].filter(Boolean).join(" — ")}
          </p>
        )}

        <div className="obs-url-box" style={{ marginTop: "8px" }}>
          <span className="obs-url-text">
            {t("OBS Browser Source ({w}×{h}):", { w: scene.width, h: scene.height })} {obsStudioUrl}
          </span>
          <button
            type="button"
            className={`copy-obs-btn ${copied ? "copied" : ""}`}
            onClick={handleCopyObsUrl}
          >
            {copied ? t("✓ COPIED") : t("COPY URL")}
          </button>
        </div>

        <section aria-label={t("PROFILE LINK TOOLS")} style={{ marginTop: "12px" }}>
          <h3 style={{ fontSize: "13px", marginBottom: "8px" }}>{t("PROFILE LINK TOOLS")}</h3>
          <form onSubmit={loadProfileUrl} style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
            <input
              className="raw-input"
              aria-label={t("PROFILE LINK TOOLS")}
              placeholder={t("Paste Studio or OBS link with ?profile=...")}
              value={profileUrl}
              onChange={(event) => setProfileUrl(event.target.value)}
              style={{ flex: "1 1 240px", minWidth: 0 }}
              disabled={busy}
              required
            />
            <button type="submit" className="btn btn-secondary" disabled={busy || !profileUrl.trim()}>{t("LOAD FROM URL")}</button>
            <button type="button" className="btn btn-secondary" onClick={async () => {
              try { await navigator.clipboard.writeText(editorStudioUrl.href); }
              catch { prompt(t("Copy Studio editor URL:"), editorStudioUrl.href); }
            }}>{t("COPY EDITOR LINK")}</button>
          </form>
          <p className="mono-font" style={{ fontSize: "11px", marginTop: "6px" }}>{t("Loads a saved profile from this server; does not import remote layouts.")}</p>
        </section>

        {/* Canvas Resolution & Grid Controls */}
        <div className="studio-toolbar-row">
          <div style={{ display: "flex", gap: "6px", flexWrap: "wrap", alignItems: "center" }}>
            {PRESET_SIZES.map((p) => {
              const active = scene.width === p.width && scene.height === p.height;
              return (
                <button
                  key={p.label}
                  type="button"
                  className={`filter-btn ${active ? "active" : ""}`}
                  onClick={() => void saveImmediate({ ...scene, width: p.width, height: p.height })}
                >
                  {t(p.label)}
                </button>
              );
            })}
          </div>

          <div style={{ display: "flex", gap: "8px", alignItems: "center", marginLeft: "auto", flexWrap: "wrap" }}>
            <label className="mono-font" style={{ fontSize: "11px", display: "flex", alignItems: "center", gap: "4px" }}>
              {t("W:")}
              <input
                type="number"
                className="raw-input"
                style={{ width: "74px", padding: "4px 6px", fontSize: "11px" }}
                value={scene.width}
                min={320}
                max={7680}
                onChange={(e) => scheduleSave({ ...scene, width: Number(e.target.value) || 1920 })}
              />
            </label>
            <label className="mono-font" style={{ fontSize: "11px", display: "flex", alignItems: "center", gap: "4px" }}>
              {t("H:")}
              <input
                type="number"
                className="raw-input"
                style={{ width: "74px", padding: "4px 6px", fontSize: "11px" }}
                value={scene.height}
                min={240}
                max={4320}
                onChange={(e) => scheduleSave({ ...scene, height: Number(e.target.value) || 1080 })}
              />
            </label>
            <button
              type="button"
              className={`filter-btn ${snapGrid ? "active" : ""}`}
              onClick={() => setSnapGrid((v) => !v)}
            >
              {snapGrid ? t("GRID SNAP: ON (10PX)") : t("GRID SNAP: OFF")}
            </button>
            <button
              type="button"
              className={`filter-btn ${showTikTokGuides ? "active" : ""}`}
              aria-pressed={showTikTokGuides}
              onClick={() => setShowTikTokGuides((visible) => !visible)}
            >
              {showTikTokGuides ? t("TIKTOK LIVE DANGER ZONES: ON") : t("TIKTOK LIVE DANGER ZONES: OFF")}
            </button>
          </div>
        </div>
        {showTikTokGuides && <p className="mono-font" style={{ fontSize: "11px", marginTop: "8px", color: "var(--status-warning)" }}>{t("Approximate TikTok LIVE UI areas; device and LIVE layout vary. Editor only — check on your phone before going live.")}</p>}
      </section>

      {/* Main Studio Workspace */}
      <div className="studio-workspace">
        {/* Visual Canvas Stage */}
        <div className="raw-card studio-stage-panel" ref={stageWrapRef} onClick={() => setSelectedId(null)}>
          <div style={{ display: "flex", flexWrap: "wrap", gap: "8px", justifyContent: "space-between", marginBottom: "10px", alignItems: "center" }}>
            <span className="mono-font" style={{ fontSize: "11px", color: "var(--ctp-subtext0)" }}>
              {t("STAGE: {w}×{h}PX ({zoom}% ZOOM) — DRAG TO MOVE, CORNER TO RESIZE", { w: scene.width, h: scene.height, zoom: Math.round(previewScale * 100) })}
            </span>
            <span className="mono-font" style={{ fontSize: "11px", color: "var(--accent-primary)" }}>
              {scene.layers.length === 1 ? t("{n} LAYER", { n: 1 }) : t("{n} LAYERS", { n: scene.layers.length })}
            </span>
            <button
              type="button"
              className="btn btn-secondary"
              style={{ padding: "4px 8px", fontSize: "11px", flexShrink: 0 }}
              aria-pressed={previewExpanded}
              onClick={(event) => {
                event.stopPropagation();
                setPreviewExpanded(!previewExpanded);
              }}
            >
              {previewExpanded ? t("RESTORE PREVIEW") : t("EXPAND PREVIEW")}
            </button>
          </div>

          <div
            className="studio-stage-outer"
            ref={stageOuterRef}
            style={{
              width: `${Math.round(scene.width * previewScale)}px`,
              height: `${Math.round(scene.height * previewScale)}px`,
            }}
          >
            <div
              className={`studio-stage-inner ${snapGrid ? "with-grid" : ""}`}
              style={{
                width: `${scene.width}px`,
                height: `${scene.height}px`,
                transform: `scale(${previewScale})`,
              }}
            >
              {scene.layers.length === 0 && (
                <div className="studio-empty-hint">
                  {t("[ EMPTY SCENE — ADD WIDGETS BELOW TO MERGE ONTO YOUR OBS SCREEN ]")}
                </div>
              )}

              {scene.layers.map((layer) => {
                if (!layer.visible) return null;
                const isSelected = layer.id === selectedId;
                return (
                  <div
                    key={layer.id}
                    className={`studio-layer-box ${isSelected ? "selected" : ""} ${layer.locked ? "locked" : ""}`}
                    style={{
                      left: `${layer.x}px`,
                      top: `${layer.y}px`,
                      width: `${layer.width}px`,
                      height: `${layer.height}px`,
                      zIndex: layer.zIndex,
                      opacity: layer.opacity,
                      transform: layer.scale !== 1 ? `scale(${layer.scale})` : undefined,
                      transformOrigin: "top left",
                    }}
                    onPointerDown={(e) => startDrag(e, layer, "move")}
                    onClick={(e) => {
                      e.stopPropagation();
                      setSelectedId(layer.id);
                    }}
                  >
                    <div className="studio-layer-badge">
                      {layer.locked ? "🔒 " : ""}
                      {layer.name} ({layer.x},{layer.y})
                    </div>
                    <iframe
                      src={layer.url || `${apiBase}/overlays/${encodeURIComponent(layer.overlayId)}/`}
                      sandbox={layer.url ? "allow-scripts allow-same-origin" : undefined}
                      referrerPolicy={layer.url ? "no-referrer" : undefined}
                      title={layer.name}
                      style={{
                        width: "100%",
                        height: "100%",
                        border: "none",
                        pointerEvents: "none",
                        background: "transparent",
                      }}
                    />
                    {!layer.locked && (
                      <div
                        className="studio-resize-handle"
                        onPointerDown={(e) => startDrag(e, layer, "resize")}
                        title={t("Drag to resize layer")}
                      />
                    )}
                  </div>
                );
              })}
              {showTikTokGuides && (
                <div className="studio-tiktok-guides" aria-label="TikTok LIVE danger zone guides">
                  {/* shortcut: approximate LIVE UI proportions; calibrate against device screenshots when exact placement is required. */}
                  <div className="studio-tiktok-zone" style={{ top: 0, left: 0, width: "100%", height: "12%" }}>{t("HEADER / LIVE INFO")}</div>
                  <div className="studio-tiktok-zone" style={{ top: "12%", right: 0, width: "18%", height: "70%" }}>{t("LIVE CONTROLS")}</div>
                  <div className="studio-tiktok-zone" style={{ bottom: "10%", left: 0, width: "82%", height: "30%" }}>{t("CHAT / GIFTS")}</div>
                  <div className="studio-tiktok-zone" style={{ bottom: 0, left: 0, width: "100%", height: "10%" }}>{t("COMMENT / BOTTOM BAR")}</div>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Right Sidebar: Add Widgets, Layer Stack, Inspector */}
        <div className="studio-side-panel">
          <section className="raw-card" aria-label="External overlay tools" style={{ padding: "14px" }}>
            <h3 style={{ fontSize: "13px", marginBottom: "10px" }}>{t("+ EXTERNAL OVERLAY URL")}</h3>
            <form onSubmit={handleAddExternalLayer} noValidate style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
              <input
                type="url"
                className="raw-input"
                aria-label="External overlay URL"
                aria-describedby={externalError ? "studio-external-help studio-external-error" : "studio-external-help"}
                aria-invalid={Boolean(externalError)}
                placeholder="https://example.com/overlay?token=..."
                value={externalUrl}
                disabled={busy}
                required
                onChange={(event) => setExternalUrl(event.target.value)}
              />
              <input
                className="raw-input"
                aria-label={t("Layer name (optional)")}
                placeholder={t("Layer name (optional)")}
                value={externalName}
                maxLength={100}
                disabled={busy}
                onChange={(event) => setExternalName(event.target.value)}
              />
              <button type="submit" className="btn btn-primary" disabled={busy || !externalUrl.trim()}>
                {t("+ ADD EXTERNAL OVERLAY")}
              </button>
            </form>
            {externalError && (
              <p id="studio-external-error" role="alert" className="mono-font" style={{ color: "var(--status-error)", fontSize: "11px", marginTop: "8px" }}>
                {externalError}
              </p>
            )}
            <p id="studio-external-help" className="mono-font" style={{ fontSize: "11px", color: "var(--ctp-subtext0)", marginTop: "8px" }}>
              {t("Use a trusted HTTP(S) overlay URL without credentials. Query parameters are kept. Some sites block iframe embedding; HTTPS pages may block HTTP embeds. Pop-ups and top navigation are disabled.")}
            </p>
          </section>

          {/* Add Installed Overlays */}
          <section className="raw-card" style={{ padding: "14px" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "10px" }}>
              <h3 style={{ fontSize: "13px" }}>{t("+ ADD OVERLAY TO SCENE")}</h3>
              <button
                type="button"
                className="btn btn-secondary"
                style={{ padding: "2px 8px", fontSize: "10px" }}
                onClick={onGoToMarket}
              >
                {t("MARKET")}
              </button>
            </div>
            {installedOverlays.length === 0 ? (
              <p className="mono-font" style={{ fontSize: "11px", color: "var(--ctp-subtext0)" }}>
                {t("No overlays installed yet. Install widgets from Overlays Market.")}
              </p>
            ) : (
              <div className="studio-palette-list">
                {installedOverlays.map((ov) => (
                  <div key={ov.id} className="studio-palette-item">
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <div style={{ fontWeight: 700, fontSize: "12px", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                        {ov.name}
                      </div>
                      <div className="mono-font" style={{ fontSize: "10px", color: "var(--ctp-subtext0)" }}>
                        {ov.width}×{ov.height} • {ov.category.toUpperCase()}
                      </div>
                    </div>
                    <button
                      type="button"
                      className="btn btn-primary"
                      style={{ padding: "4px 10px", fontSize: "10px" }}
                      onClick={() => handleAddLayer(ov)}
                    >
                      {t("+ ADD")}
                    </button>
                  </div>
                ))}
              </div>
            )}
          </section>

          {/* Layer Stack (Z-Order) */}
          <section className="raw-card" style={{ padding: "14px" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "10px" }}>
              <h3 style={{ fontSize: "13px" }}>{t("LAYERS (TOP TO BOTTOM)")}</h3>
              {scene.layers.length > 0 && (
                <button
                  type="button"
                  className="btn btn-destructive"
                  style={{ padding: "2px 8px", fontSize: "10px" }}
                  onClick={() => {
                    setSelectedId(null);
                    void saveImmediate({ ...scene, layers: [] });
                  }}
                >
                  {t("CLEAR ALL")}
                </button>
              )}
            </div>

            {sortedLayers.length === 0 ? (
              <p className="mono-font" style={{ fontSize: "11px", color: "var(--ctp-subtext0)" }}>
                {t("No layers in scene.")}
              </p>
            ) : (
              <div className="studio-layer-list">
                {sortedLayers.map((layer, i) => {
                  const isSel = layer.id === selectedId;
                  return (
                    <div
                      key={layer.id}
                      className={`studio-layer-row ${isSel ? "active" : ""}`}
                      onClick={() => setSelectedId(layer.id)}
                    >
                      <span className="mono-font" style={{ fontSize: "10px", color: "var(--ctp-subtext0)" }}>
                        #{layer.zIndex}
                      </span>
                      <span
                        style={{
                          flex: 1,
                          fontSize: "12px",
                          fontWeight: 700,
                          whiteSpace: "nowrap",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          textDecoration: layer.visible ? "none" : "line-through",
                          color: layer.visible ? "var(--text-primary)" : "var(--text-muted)",
                        }}
                      >
                        {layer.name}
                      </span>
                      <div style={{ display: "flex", gap: "4px" }} onClick={(e) => e.stopPropagation()}>
                        <button
                          type="button"
                          className="studio-icon-btn"
                          disabled={i === 0}
                          title={t("Bring Forward")}
                          onClick={() => handleShiftZ(layer.id, "up")}
                        >
                          ↑
                        </button>
                        <button
                          type="button"
                          className="studio-icon-btn"
                          disabled={i === sortedLayers.length - 1}
                          title={t("Send Backward")}
                          onClick={() => handleShiftZ(layer.id, "down")}
                        >
                          ↓
                        </button>
                        <button
                          type="button"
                          className="studio-icon-btn"
                          title={layer.visible ? t("Hide Layer") : t("Show Layer")}
                          onClick={() => updateLayer(layer.id, { visible: !layer.visible })}
                        >
                          {layer.visible ? "👁" : "🚫"}
                        </button>
                        <button
                          type="button"
                          className="studio-icon-btn"
                          title={layer.locked ? t("Unlock Layer") : t("Lock Position")}
                          onClick={() => updateLayer(layer.id, { locked: !layer.locked })}
                        >
                          {layer.locked ? "🔒" : "🔓"}
                        </button>
                        <button
                          type="button"
                          className="studio-icon-btn danger"
                          title={t("Remove Layer")}
                          onClick={() => handleRemoveLayer(layer.id)}
                        >
                          ✕
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </section>

          {/* Selected Layer Inspector */}
          {selectedLayer && (
            <section className="raw-card" style={{ padding: "14px" }}>
              <h3 style={{ fontSize: "13px", marginBottom: "10px" }}>
                {t("INSPECTOR: {name}", { name: selectedLayer.name })}
              </h3>

              <div className="studio-inspector-grid">
                <label>
                  <span>X (PX)</span>
                  <input
                    type="number"
                    className="raw-input"
                    value={selectedLayer.x}
                    disabled={selectedLayer.locked}
                    onChange={(e) => updateLayer(selectedLayer.id, { x: Number(e.target.value) || 0 })}
                  />
                </label>
                <label>
                  <span>Y (PX)</span>
                  <input
                    type="number"
                    className="raw-input"
                    value={selectedLayer.y}
                    disabled={selectedLayer.locked}
                    onChange={(e) => updateLayer(selectedLayer.id, { y: Number(e.target.value) || 0 })}
                  />
                </label>
                <label>
                  <span>{t("WIDTH (PX)")}</span>
                  <input
                    type="number"
                    className="raw-input"
                    value={selectedLayer.width}
                    min={40}
                    disabled={selectedLayer.locked}
                    onChange={(e) => updateLayer(selectedLayer.id, { width: Math.max(40, Number(e.target.value) || 40) })}
                  />
                </label>
                <label>
                  <span>{t("HEIGHT (PX)")}</span>
                  <input
                    type="number"
                    className="raw-input"
                    value={selectedLayer.height}
                    min={20}
                    disabled={selectedLayer.locked}
                    onChange={(e) => updateLayer(selectedLayer.id, { height: Math.max(20, Number(e.target.value) || 20) })}
                  />
                </label>
                <label>
                  <span>{t("SCALE ({s}x)", { s: selectedLayer.scale.toFixed(2) })}</span>
                  <input
                    type="range"
                    min="0.25"
                    max="3"
                    step="0.05"
                    value={selectedLayer.scale}
                    disabled={selectedLayer.locked}
                    onChange={(e) => updateLayer(selectedLayer.id, { scale: Number(e.target.value) })}
                  />
                </label>
                <label>
                  <span>{t("OPACITY ({o}%)", { o: Math.round(selectedLayer.opacity * 100) })}</span>
                  <input
                    type="range"
                    min="0.1"
                    max="1"
                    step="0.05"
                    value={selectedLayer.opacity}
                    onChange={(e) => updateLayer(selectedLayer.id, { opacity: Number(e.target.value) })}
                  />
                </label>
              </div>

              <div style={{ marginTop: "10px" }}>
                <span className="mono-font" style={{ fontSize: "10px", color: "var(--ctp-subtext0)", display: "block", marginBottom: "6px" }}>
                  {t("QUICK SNAP ALIGN")}
                </span>
                <div style={{ display: "flex", gap: "4px", flexWrap: "wrap" }}>
                  <button type="button" className="filter-btn" disabled={selectedLayer.locked} onClick={() => alignSelected("tl")}>
                    {t("↖ TOP-L")}
                  </button>
                  <button type="button" className="filter-btn" disabled={selectedLayer.locked} onClick={() => alignSelected("tr")}>
                    {t("↗ TOP-R")}
                  </button>
                  <button type="button" className="filter-btn" disabled={selectedLayer.locked} onClick={() => alignSelected("center")}>
                    {t("⊕ CENTER")}
                  </button>
                  <button type="button" className="filter-btn" disabled={selectedLayer.locked} onClick={() => alignSelected("bl")}>
                    {t("↙ BOT-L")}
                  </button>
                  <button type="button" className="filter-btn" disabled={selectedLayer.locked} onClick={() => alignSelected("br")}>
                    {t("↘ BOT-R")}
                  </button>
                </div>
              </div>
            </section>
          )}
        </div>
      </div>
    </div>
  );
};
