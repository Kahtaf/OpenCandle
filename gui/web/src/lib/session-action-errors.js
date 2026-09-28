// Session action failures, keyed by the failing request's actionId.
//
// The GUI connection receives every server `error` frame (the server echoes
// the failing request's actionId), but the component that sent the request
// is the one that must react, for example to re-enable a control it disabled
// while its request was in flight.
const listeners = new Set();

export function notifySessionActionError(actionId) {
  const id = String(actionId || "");
  if (!id) return;
  for (const listener of [...listeners]) listener(id);
}

export function subscribeSessionActionErrors(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
