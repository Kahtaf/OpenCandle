import { useEffect, useState } from "react";

// A worker is an installable update only while it waits in the `installed`
// state behind a worker that already controls the page. A first install also
// passes through `registration.waiting` on its way to activation, with no
// controller yet; that is not an update (#219).
function isPendingUpdate(worker) {
  return Boolean(worker && worker.state === "installed" && navigator.serviceWorker?.controller);
}

// A service-worker update can be discovered before the consuming surface
// mounts, so the hook reads the current registration once and then follows
// the app's update-ready announcements. It drops the worker as soon as it
// stops waiting, and re-reads the registration when the controller changes.
export function useWaitingServiceWorker() {
  const [waitingWorker, setWaitingWorker] = useState(null);

  useEffect(() => {
    const container = navigator.serviceWorker;
    let cancelled = false;
    let tracked = null;

    const onStateChange = () => {
      if (tracked && tracked.state !== "installed") adopt(null);
    };
    function adopt(worker) {
      const next = isPendingUpdate(worker) ? worker : null;
      if (next !== tracked) {
        tracked?.removeEventListener?.("statechange", onStateChange);
        next?.addEventListener?.("statechange", onStateChange);
        tracked = next;
      }
      setWaitingWorker(next);
    }
    const recheck = () => {
      container
        ?.getRegistration?.()
        .then((registration) => {
          if (!cancelled) adopt(registration?.waiting ?? null);
        })
        .catch(() => {});
    };
    const onUpdateReady = (event) => adopt(event.detail?.registration?.waiting ?? null);

    recheck();
    addEventListener("opencandle:update-ready", onUpdateReady);
    container?.addEventListener?.("controllerchange", recheck);
    return () => {
      cancelled = true;
      tracked?.removeEventListener?.("statechange", onStateChange);
      removeEventListener("opencandle:update-ready", onUpdateReady);
      container?.removeEventListener?.("controllerchange", recheck);
    };
  }, []);

  return waitingWorker;
}
