// Session action failures, keyed by the failing request's actionId.
//
// The GUI connection receives every server `error` frame (the server echoes
// the failing request's actionId), but the component that sent the request
// is the one that must react, for example to re-enable a control it disabled
// while its request was in flight.
const SESSION_ACTION_ERROR_EVENT = "opencandle:session-action-error";

export function notifySessionActionError(actionId) {
  const id = String(actionId || "");
  if (!id || typeof globalThis.dispatchEvent !== "function") return;
  globalThis.dispatchEvent(
    new CustomEvent(SESSION_ACTION_ERROR_EVENT, { detail: { actionId: id } }),
  );
}

export function subscribeSessionActionErrors(listener) {
  if (typeof globalThis.addEventListener !== "function") return () => {};
  const handle = (event) => listener(String(event?.detail?.actionId || ""));
  globalThis.addEventListener(SESSION_ACTION_ERROR_EVENT, handle);
  return () => globalThis.removeEventListener(SESSION_ACTION_ERROR_EVENT, handle);
}
