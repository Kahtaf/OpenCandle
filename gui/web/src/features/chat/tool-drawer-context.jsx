import { createContext, useCallback, useContext, useMemo, useRef, useState } from "react";

const ToolDrawerContext = createContext(null);

// Holds the currently-open tool run (the one whose StepsCard the user
// clicked). One drawer instance lives at the App level and reads this state
// to render. We keep the entire run object — not just an id — so the drawer
// can stream-update as new steps come in without re-querying the entries.
export function ToolDrawerProvider({ children }) {
  const [run, setRun] = useState(null);
  // The auto-open trigger: when the assistant starts a new tool run we want
  // the drawer to pop open once, but never re-open if the user explicitly
  // closed it. Track which run ids we've already auto-handled.
  const seenAutoOpenRef = useRef(new Set());

  const open = useCallback((nextRun) => {
    if (!nextRun) return;
    setRun(nextRun);
  }, []);

  const close = useCallback(() => {
    setRun(null);
  }, []);

  // Called by StepsCard on first render of a pending run.
  const requestAutoOpen = useCallback((nextRun) => {
    if (!nextRun || nextRun.status !== "pending") return;
    if (seenAutoOpenRef.current.has(nextRun.id)) return;
    seenAutoOpenRef.current.add(nextRun.id);
    setRun(nextRun);
  }, []);

  const value = useMemo(() => ({ run, open, close, requestAutoOpen }), [run, open, close, requestAutoOpen]);

  return <ToolDrawerContext.Provider value={value}>{children}</ToolDrawerContext.Provider>;
}

export function useToolDrawer() {
  const ctx = useContext(ToolDrawerContext);
  if (!ctx) throw new Error("useToolDrawer must be used inside ToolDrawerProvider");
  return ctx;
}
