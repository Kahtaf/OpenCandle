import { useEffect, useState } from "react";

// A service-worker update can be discovered before the consuming surface
// mounts, so the hook reads the current registration once and then follows
// the app's update-ready announcements.
export function useWaitingServiceWorker() {
  const [waitingWorker, setWaitingWorker] = useState(null);

  useEffect(() => {
    let cancelled = false;
    navigator.serviceWorker
      ?.getRegistration?.()
      .then((registration) => {
        if (!cancelled && registration?.waiting) setWaitingWorker(registration.waiting);
      })
      .catch(() => {});
    const onUpdateReady = (event) => setWaitingWorker(event.detail?.registration?.waiting ?? null);
    addEventListener("opencandle:update-ready", onUpdateReady);
    return () => {
      cancelled = true;
      removeEventListener("opencandle:update-ready", onUpdateReady);
    };
  }, []);

  return waitingWorker;
}
