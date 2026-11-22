export function resolveApiBase(loc?: Pick<Location, "protocol" | "hostname">): string {
  const target = loc ?? (typeof window !== "undefined" ? window.location : undefined);
  if (!target || !target.hostname) return "http://127.0.0.1:3001";
  const { protocol, hostname } = target;
  if (protocol === "tauri:" || hostname === "tauri.localhost" || hostname.endsWith(".localhost")) {
    return "http://127.0.0.1:3001";
  }
  const apiProtocol = protocol === "https:" ? "https:" : "http:";
  const host = hostname.includes(":") && !hostname.startsWith("[") ? `[${hostname}]` : hostname;
  return `${apiProtocol}//${host}:3001`;
}

export const API_BASE = resolveApiBase();
