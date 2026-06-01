import type { IncomingHttpHeaders } from "node:http";

const PRIVATE_API_COOKIE = "opencandle_gui_session";

export function isLoopbackAddress(remoteAddress: string | undefined): boolean {
  if (remoteAddress == null || remoteAddress === "") return false;
  return (
    remoteAddress === "::1" ||
    remoteAddress === "localhost" ||
    remoteAddress.startsWith("127.") ||
    remoteAddress.startsWith("::ffff:127.")
  );
}

export function isTrustedPrivateApiRequest(
  remoteAddress: string | undefined,
  headers: IncomingHttpHeaders,
  sessionToken: string,
): boolean {
  if (isLoopbackAddress(remoteAddress)) return true;
  return cookieValue(headers.cookie, PRIVATE_API_COOKIE) === sessionToken;
}

export function privateApiCookieHeader(sessionToken: string): string {
  return `${PRIVATE_API_COOKIE}=${encodeURIComponent(sessionToken)}; Path=/; HttpOnly; SameSite=Strict`;
}

function cookieValue(header: string | string[] | undefined, name: string): string | undefined {
  const value = Array.isArray(header) ? header.join("; ") : header;
  if (value == null) return undefined;
  for (const part of value.split(";")) {
    const [rawKey, ...rawValue] = part.trim().split("=");
    if (rawKey === name) return decodeURIComponent(rawValue.join("="));
  }
  return undefined;
}
