import { providerStatus, statusLabel } from "../provider-builders/provider-status-info.js";

// Hosted runs cannot install a CLI or read desktop browser cookies, and a
// descriptor whose browser transport is blocked has no hosted path at all.
export function isLocalOnly(provider) {
  if (provider.browserTransport === "blocked") return true;
  return provider.hosted === true && provider.kind === "external-tool";
}

export function statusLine(provider, status = providerStatus(provider)) {
  if (status === "env") return `Managed by ${provider.envVar}`;
  if (status === "file" || status === "configured") {
    return provider.maskedKeyHint ? `Configured (${provider.maskedKeyHint})` : "Configured";
  }
  const snoozedUntil = snoozeDate(provider);
  if (snoozedUntil) return `Snoozed until ${snoozedUntil}`;
  if (provider.onboarding?.status === "never_ask" || status === "skipped") {
    return "Never ask, until you turn it back on";
  }
  return statusLabel(status);
}

function snoozeDate(provider) {
  const raw = provider.onboarding?.snoozeUntil;
  if (!raw) return "";
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return "";
  return parsed.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}
