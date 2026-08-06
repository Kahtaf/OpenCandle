import { Globe2, KeyRound, Terminal } from "lucide-react";

// Provider status vocabulary shared by the provider rows and the three
// builders. Non-component helpers live here so the component module stays
// Fast Refresh safe.

export function providerStatus(provider) {
  return provider.statusDetail?.state ?? provider.status ?? provider.source ?? "absent";
}

export function providerIcon(provider) {
  if (provider.kind === "external-tool") return Terminal;
  if (provider.kind === "public-http") return Globe2;
  return KeyRound;
}

export function statusLabel(status) {
  if (status === "configured") return "Configured";
  if (status === "file") return "Configured";
  if (status === "env") return "From environment";
  if (status === "installed") return "Installed";
  if (status === "missing") return "Missing";
  if (status === "session_ok") return "Session ready";
  if (status === "session_missing") return "Login needed";
  if (status === "session_stale") return "Session stale";
  if (status === "skipped") return "Skipped";
  if (status === "reachable") return "Reachable";
  if (status === "unreachable") return "Unreachable";
  if (status === "error") return "Needs attention";
  if (status === "unknown") return "Not verified yet";
  return "Not configured";
}

export function statusColor(status) {
  if (successStatuses.has(status)) return "text-success";
  if (infoStatuses.has(status)) return "text-info";
  if (dangerStatuses.has(status)) return "text-destructive";
  return "text-warning";
}

export const successStatuses = new Set([
  "configured",
  "file",
  "installed",
  "session_ok",
  "reachable",
]);
export const infoStatuses = new Set(["env", "skipped"]);
export const dangerStatuses = new Set(["error", "unreachable"]);

export function formatRelativeTime(value) {
  const timestamp = Date.parse(value);
  if (Number.isNaN(timestamp)) return "just now";
  const seconds = Math.max(0, Math.round((Date.now() - timestamp) / 1000));
  if (seconds < 60) return "just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  return `${days}d ago`;
}
