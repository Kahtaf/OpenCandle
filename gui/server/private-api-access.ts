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
  headers: IncomingHttpHeaders,
  sessionToken: string,
  remoteAddress: string | undefined,
  options: { allowRemote?: boolean } = {},
): boolean {
  if (!options.allowRemote && !isLoopbackAddress(remoteAddress)) return false;
  if (cookieValue(headers.cookie, PRIVATE_API_COOKIE) !== sessionToken) return false;

  const fetchSite = headerValue(headers["sec-fetch-site"]);
  if (fetchSite != null && fetchSite !== "same-origin" && fetchSite !== "none") return false;

  const origin = headerValue(headers.origin);
  const host = headerValue(headers.host);
  if (origin != null && host != null) {
    try {
      if (new URL(origin).host !== host) return false;
    } catch {
      return false;
    }
  }

  return true;
}

export function privateApiCookieHeader(sessionToken: string): string {
  return `${PRIVATE_API_COOKIE}=${encodeURIComponent(sessionToken)}; Path=/; HttpOnly; SameSite=Strict`;
}

function cookieValue(header: string | string[] | undefined, name: string): string | undefined {
  const value = Array.isArray(header) ? header.join("; ") : header;
  if (value == null) return undefined;
  for (const part of value.split(";")) {
    const [rawKey, ...rawValue] = part.trim().split("=");
    if (rawKey === name) {
      try {
        return decodeURIComponent(rawValue.join("="));
      } catch {
        return undefined;
      }
    }
  }
  return undefined;
}

function headerValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}
