export function hostFrom(url) {
  if (!url) return "";
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return (
      String(url)
        .replace(/^www\./, "")
        .split("/")[0] || ""
    );
  }
}

export function shortHost(url) {
  const host = hostFrom(url);
  if (!host) return "";
  const parts = host.split(".");
  if (parts.length <= 1) return host;
  return parts.slice(-2, -1)[0] || host;
}
