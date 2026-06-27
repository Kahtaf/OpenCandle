import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

const ToolDrawerContext = createContext(null);

// Holds the currently-open tool run (the one whose StepsCard the user
// clicked). One drawer instance lives at the App level and reads this state
// to render. We keep the entire run object — not just an id — so the drawer
// can stream-update as new steps come in without re-querying the entries.
export function ToolDrawerProvider({ activeSessionId = "", children }) {
  const [run, setRun] = useState(null);
  // The auto-open trigger: when the assistant starts a new tool run we want
  // the drawer to pop open once, but never re-open if the user explicitly
  // closed it. Track which run ids we've already auto-handled.
  const seenAutoOpenRef = useRef(new Set());

  useEffect(() => {
    if (!run || !activeSessionId) return;
    if (run.sessionId && run.sessionId !== activeSessionId) setRun(null);
  }, [activeSessionId, run]);

  const open = useCallback(
    (nextRun) => {
      if (!nextRun) return;
      if (activeSessionId && nextRun.sessionId && nextRun.sessionId !== activeSessionId) return;
      setRun(nextRun);
    },
    [activeSessionId],
  );

  const close = useCallback(() => {
    setRun(null);
  }, []);

  // Called by StepsCard on first render of a pending run.
  const requestAutoOpen = useCallback(
    (nextRun) => {
      if (nextRun?.status !== "pending") return;
      if (activeSessionId && nextRun.sessionId && nextRun.sessionId !== activeSessionId) return;
      const key = runKey(nextRun);
      if (seenAutoOpenRef.current.has(key)) return;
      seenAutoOpenRef.current.add(key);
      setRun(nextRun);
    },
    [activeSessionId],
  );

  const value = useMemo(
    () => ({ run, open, close, requestAutoOpen }),
    [run, open, close, requestAutoOpen],
  );

  return <ToolDrawerContext.Provider value={value}>{children}</ToolDrawerContext.Provider>;
}

export function useToolDrawer() {
  const ctx = useContext(ToolDrawerContext);
  if (!ctx) throw new Error("useToolDrawer must be used inside ToolDrawerProvider");
  return ctx;
}

function runKey(run) {
  return `${run?.sessionId || ""}::${run?.id || ""}`;
}
