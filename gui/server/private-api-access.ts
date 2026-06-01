import type { IncomingHttpHeaders } from "node:http";

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
): boolean {
  if (isLoopbackAddress(remoteAddress)) return true;
  if (headerValue(headers["sec-fetch-site"]) === "same-origin") return true;

  const origin = headerValue(headers.origin);
  const host = headerValue(headers.host);
  if (origin == null || host == null) return false;
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

function headerValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}
