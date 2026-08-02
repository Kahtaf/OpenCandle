const TURNSTILE_SCRIPT_URL =
  "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
const DEFAULT_TIMEOUT_MS = 30_000;

let turnstileApiPromise;

export async function requestTurnstileAttestation(options = {}) {
  const sitekey = String(options.sitekey ?? "").trim();
  if (!sitekey) throw new Error("Turnstile site key is not configured");
  const documentRef = options.documentRef ?? globalThis.document;
  if (!documentRef?.body) throw new Error("Turnstile requires a browser document");
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const deadline = Date.now() + timeoutMs;
  const api = options.turnstileApi ?? (await loadTurnstileApi(documentRef, timeoutMs));
  const remainingMs = Math.max(1, deadline - Date.now());
  const container = documentRef.createElement("div");
  container.style.position = "fixed";
  container.style.inset = "auto 1rem 1rem auto";
  container.style.zIndex = "2147483647";
  documentRef.body.append(container);

  return new Promise((resolve, reject) => {
    let widgetId;
    let settled = false;
    const finish = (error, token) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      if (widgetId !== undefined) api.remove(widgetId);
      container.remove();
      if (error) reject(error);
      else resolve(token);
    };
    const timeout = setTimeout(
      () => finish(new Error("Turnstile verification timed out")),
      remainingMs,
    );
    try {
      widgetId = api.render(container, {
        sitekey,
        action: "turnstile-spin-v1",
        execution: "execute",
        appearance: "interaction-only",
        "response-field": false,
        "refresh-expired": "never",
        callback: (token) =>
          typeof token === "string" && token.length > 0 && token.length <= 2_048
            ? finish(undefined, token)
            : finish(new Error("Turnstile verification failed")),
        "error-callback": () => finish(new Error("Turnstile verification failed")),
        "expired-callback": () => finish(new Error("Turnstile verification expired")),
      });
      api.execute(widgetId);
    } catch (error) {
      finish(error instanceof Error ? error : new Error("Turnstile verification failed"));
    }
  });
}

function loadTurnstileApi(documentRef, timeoutMs) {
  if (globalThis.turnstile) return Promise.resolve(globalThis.turnstile);
  turnstileApiPromise ??= new Promise((resolve, reject) => {
    const script = documentRef.createElement("script");
    script.src = TURNSTILE_SCRIPT_URL;
    script.async = true;
    script.defer = true;
    let settled = false;
    const finish = (error, api, removeScript = false) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      script.removeEventListener("load", onLoad);
      script.removeEventListener("error", onError);
      if (removeScript) script.remove();
      if (error) reject(error);
      else resolve(api);
    };
    const onLoad = () =>
      globalThis.turnstile
        ? finish(undefined, globalThis.turnstile)
        : finish(new Error("Turnstile API did not initialize"), undefined, true);
    const onError = () =>
      finish(new Error("Turnstile API failed to load"), undefined, true);
    const timeout = setTimeout(
      () => finish(new Error("Turnstile API load timed out"), undefined, true),
      timeoutMs,
    );
    script.addEventListener("load", onLoad);
    script.addEventListener("error", onError);
    documentRef.head.append(script);
  }).catch((error) => {
    turnstileApiPromise = undefined;
    throw error;
  });
  return turnstileApiPromise;
}
