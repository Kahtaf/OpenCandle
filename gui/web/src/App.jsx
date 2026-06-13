import { lazy, Suspense, useCallback, useEffect, useRef, useState } from "react";
import { useNavigate, useRouterState } from "@tanstack/react-router";
import { ChatPanel } from "./features/chat/ChatPanel.jsx";
import { ToolDrawerInline, ToolDrawerOverlay } from "./features/chat/tool-drawer.jsx";
import { ToolDrawerProvider } from "./features/chat/tool-drawer-context.jsx";
import { createOptimisticUserMessageEvents } from "./features/chat/optimistic-user-message.js";
import { FinancialContextDrawer } from "./features/context-panel/FinancialContextPanel.jsx";
import { MarketStatePage } from "./features/market-state/MarketStatePage.jsx";
import { SessionDrawer, SessionSidebar } from "./features/sessions/SessionHistory.jsx";
import { chatRunSessionTarget, hasSessionContent, routeSessionView, shouldStartFreshHomeSession } from "./features/sessions/route-session-state.js";
import { useChatRun } from "./hooks/useChatRun.jsx";
import { useGuiConnection } from "./hooks/useGuiConnection.jsx";
import { Toaster } from "./components/ui/toaster.jsx";

const loadCatalogOverlay = () => import("./features/catalog/CatalogOverlay.jsx");
const CatalogOverlay = lazy(() => loadCatalogOverlay().then((module) => ({ default: module.CatalogOverlay })));

const CATALOG_DRAWERS = new Set(["catalog", "tools", "workflows", "providers"]);

export function AppShell() {
  const navigate = useNavigate();
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const search = useRouterState({ select: (state) => state.location.search });
  const gui = useGuiConnection();
  const [liveEvents, setLiveEvents] = useState([]);
  const [liveBaseEntryCount, setLiveBaseEntryCount] = useState(0);
  const chatRun = useChatRun({
    setToast: gui.setToast,
    onRunStart: useCallback((prompt, baseEntryCount) => {
      setLiveBaseEntryCount(baseEntryCount ?? gui.entries.length);
      setLiveEvents(createOptimisticUserMessageEvents(prompt));
    }, [gui.entries.length]),
    onEvent: useCallback((event) => {
      setLiveEvents((current) => [...current, event]);
      if (event.type !== "run.started" || !event.sessionId) return;
      const sessionId = String(event.sessionId);
      const sessionPath = `/sessions/${encodeURIComponent(sessionId)}`;
      if (pathname === sessionPath) return;
      void navigate({
        to: "/sessions/$sessionId",
        params: { sessionId },
        search: (current) => ({ ...current, drawer: undefined }),
      });
    }, [pathname, navigate]),
  });
  const activeDrawer = search?.drawer;
  const catalogOpen = CATALOG_DRAWERS.has(activeDrawer);
  const sessionsOpen = activeDrawer === "history" || pathname === "/history";
  const contextOpen = activeDrawer === "context";
  // Composer draft is lifted here so the catalog can pre-fill it via fillComposer.
  const [draft, setDraft] = useState("");
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const homeResetSessionRef = useRef("");
  const freshRunPendingRef = useRef(false);
  const sessionView = routeSessionView({
    pathname,
    currentSessionId: gui.currentSessionId,
    entries: gui.entries,
    runState: chatRun.runState,
    liveBaseEntryCount,
    canStartFreshHomeSession: gui.supportsSessionActions,
  });
  const visibleAskUserPrompts = gui.askUserPrompts.filter((prompt) =>
    !prompt.sessionId || prompt.sessionId === sessionView.activeSessionId
  );
  const inputDisabled = gui.role !== "writer"
    || sessionView.pendingSessionSwitch;

  const openDrawer = useCallback((drawer) => {
    void navigate({ search: (current) => ({ ...current, drawer }) });
  }, [navigate]);

  const closeDrawer = useCallback(() => {
    void navigate({ search: (current) => ({ ...current, drawer: undefined }) });
  }, [navigate]);

  useEffect(() => {
    const onKeyDown = (event) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        loadCatalogOverlay();
        openDrawer("catalog");
      }
      if (event.key === "Escape") {
        closeDrawer();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [closeDrawer, openDrawer]);

  useEffect(() => {
    if (!sessionView.routeSessionId || sessionView.routeSessionId === gui.currentSessionId || gui.sessions.length === 0) return;
    const session = gui.sessions.find((candidate) => candidate.id === sessionView.routeSessionId);
    if (session) gui.send("session.open", { path: session.path });
  }, [gui.currentSessionId, gui.sessions, gui.send, sessionView.routeSessionId]);

  useEffect(() => {
    if (pathname !== "/") {
      homeResetSessionRef.current = "";
      return;
    }
    if (!shouldStartFreshHomeSession({
      pathname,
      role: gui.role,
      currentSessionId: gui.currentSessionId,
      entryCount: hasSessionContent(gui.entries) ? gui.entries.length : 0,
      lastResetSessionId: homeResetSessionRef.current,
      canStartFreshHomeSession: gui.supportsSessionActions,
    })) return;
    homeResetSessionRef.current = gui.currentSessionId;
    void gui.newSession();
  }, [pathname, gui.role, gui.currentSessionId, gui.entries.length, gui.newSession, gui.supportsSessionActions]);

  useEffect(() => {
    if (liveEvents.length === 0 || chatRun.runState === "connecting" || chatRun.runState === "streaming") return;
    if (gui.entries.length > liveBaseEntryCount) setLiveEvents([]);
  }, [chatRun.runState, gui.entries.length, liveBaseEntryCount, liveEvents.length]);

  const openCatalog = useCallback((target = "catalog") => {
    loadCatalogOverlay();
    const drawer = CATALOG_DRAWERS.has(target) ? target : "catalog";
    openDrawer(drawer);
  }, [openDrawer]);

  const fillComposer = useCallback((text) => {
    setDraft(String(text ?? ""));
    // Move focus into the composer once the catalog finishes its close animation.
    setTimeout(() => {
      const composer = document.getElementById("chat-composer");
      composer?.focus?.();
      if (composer instanceof HTMLTextAreaElement) {
        composer.setSelectionRange(composer.value.length, composer.value.length);
      }
    }, 220);
  }, []);

  // Home sends always run in a fresh session so a stale client can never
  // append to the previous writer session; the server rejects mismatches
  // with a session_changed 409, retried once against another fresh session.
  const startRoutedChatRun = useCallback(async (prompt) => {
    const target = chatRunSessionTarget({ pathname, supportsSessionActions: gui.supportsSessionActions });
    if (target.mode === "current") {
      void chatRun.startChatRun(prompt);
      return;
    }
    if (target.mode === "route") {
      const result = await chatRun.startChatRun(prompt, { sessionId: target.sessionId });
      if (result?.sessionChanged) {
        setLiveEvents([]);
        gui.setToast("The active session changed before your message was sent. Please resend.", { destructive: true });
      }
      return;
    }
    if (freshRunPendingRef.current) return;
    freshRunPendingRef.current = true;
    try {
      for (let attempt = 0; attempt < 2; attempt++) {
        const freshSessionId = await gui.newSession();
        if (!freshSessionId) return;
        homeResetSessionRef.current = freshSessionId;
        const result = await chatRun.startChatRun(prompt, { sessionId: freshSessionId, baseEntryCount: 0 });
        if (!result?.sessionChanged) return;
      }
      setLiveEvents([]);
      gui.setToast("The active session changed before your message was sent. Please resend.", { destructive: true });
    } finally {
      freshRunPendingRef.current = false;
    }
  }, [pathname, gui.supportsSessionActions, gui.newSession, gui.setToast, chatRun.startChatRun]);

  const newSession = useCallback(() => {
    void gui.newSession();
    void navigate({ to: "/", search: (current) => ({ ...current, drawer: undefined }) });
  }, [gui, navigate]);

  const openSession = useCallback((session) => {
    gui.send("session.open", { path: session.path });
    setSidebarCollapsed(false);
    void navigate({
      to: "/sessions/$sessionId",
      params: { sessionId: session.id },
      search: (current) => ({ ...current, drawer: undefined }),
    });
  }, [gui, navigate]);

  const renameSession = useCallback((session, name) => {
    gui.send("session.rename", { path: session.path, name });
  }, [gui]);

  const deleteSession = useCallback((session) => {
    gui.send("session.delete", { path: session.path });
    if (session.id === gui.currentSessionId) {
      void navigate({ to: "/", search: (current) => ({ ...current, drawer: undefined }) });
    }
  }, [gui, navigate]);

  const sidebarProps = {
    sessions: gui.sessions,
    currentSessionId: sessionView.activeSessionId,
    currentPath: pathname,
    collapsed: sidebarCollapsed,
    onCollapse: () => setSidebarCollapsed(true),
    onOpenSession: openSession,
    onRenameSession: renameSession,
    onDeleteSession: deleteSession,
    onNewSession: newSession,
  };

  const initialCatalogTab = activeDrawer === "tools"
    ? "tools"
    : activeDrawer === "providers"
      ? "providers"
      : activeDrawer === "workflows"
        ? "workflows"
        : "workflows";
  const marketDomain = domainFromPath(pathname);
  return (
    <ToolDrawerProvider>
      <div className="flex overflow-hidden bg-background" style={{ height: "100dvh" }}>
        <SessionSidebar {...sidebarProps} />
        <ConnectionStatusBanner role={gui.role} />
        {marketDomain ? (
          <MarketStatePage
            domain={marketDomain}
            role={gui.role}
            send={gui.send}
            invokeTool={gui.invokeTool}
            navigate={navigate}
            setToast={gui.setToast}
            onOpenSidebar={() => openDrawer("history")}
            sidebarCollapsed={sidebarCollapsed}
            onExpandSidebar={() => setSidebarCollapsed(false)}
          />
        ) : (
          <ChatPanel
            entries={sessionView.entries}
            liveEvents={liveEvents}
            askUserPrompts={visibleAskUserPrompts}
            modelSetup={gui.modelSetup}
            role={gui.role}
            inputDisabled={inputDisabled}
            runState={chatRun.runState}
            lastPrompt={chatRun.lastPrompt}
            catalog={gui.catalog}
            send={gui.send}
            startChatRun={startRoutedChatRun}
            stopRun={chatRun.stopRun}
            retryRun={chatRun.retryRun}
            setToast={gui.setToast}
            draft={draft}
            setDraft={setDraft}
            onOpenCommandPalette={openCatalog}
            onOpenSidebar={() => openDrawer("history")}
            onOpenContext={() => openDrawer("context")}
            sidebarCollapsed={sidebarCollapsed}
            onExpandSidebar={() => setSidebarCollapsed(false)}
          />
        )}
        <ToolDrawerInline />
      </div>
      <ToolDrawerOverlay />
      <SessionDrawer open={sessionsOpen} {...sidebarProps} onClose={closeDrawer} />
      <FinancialContextDrawer
        open={contextOpen}
        state={gui.dashboard}
        catalog={gui.catalog}
        onClose={closeDrawer}
        onOpenMarketState={(path) => {
          closeDrawer();
          void navigate({ to: path, search: (current) => ({ ...current, drawer: undefined }) });
        }}
        onConfigureProvider={() => {
          closeDrawer();
          openCatalog("providers");
        }}
      />
      <Suspense fallback={null}>
        {catalogOpen ? (
          <CatalogOverlay
            open={catalogOpen}
            initialTab={initialCatalogTab}
            catalog={gui.catalog}
            onClose={closeDrawer}
            send={gui.send}
            setToast={gui.setToast}
            startChatRun={startRoutedChatRun}
            fillComposer={fillComposer}
          />
        ) : null}
      </Suspense>
      <Toaster />
    </ToolDrawerProvider>
  );
}

function ConnectionStatusBanner({ role }) {
  if (role !== "connecting" && role !== "disconnected") return null;
  const message = role === "connecting"
    ? "Connecting to the GUI session..."
    : "Reconnecting to the GUI session. Editing is disabled until the writer reconnects.";
  return (
    <div
      className="fixed left-1/2 top-3 z-[90] max-w-[calc(100vw-24px)] -translate-x-1/2 rounded-md border border-border bg-card px-3 py-2 text-xs text-muted-foreground shadow-subtle-md"
      role="status"
      aria-live="polite"
    >
      {message}
    </div>
  );
}

function domainFromPath(pathname) {
  if (pathname === "/watchlists") return "watchlists";
  if (pathname === "/portfolios") return "portfolios";
  if (pathname === "/alerts") return "alerts";
  if (pathname === "/reports") return "reports";
  if (pathname === "/predictions") return "predictions";
  return "";
}
