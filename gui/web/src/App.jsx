import { lazy, Suspense, useCallback, useEffect, useRef, useState } from "react";
import { useNavigate, useRouterState } from "@tanstack/react-router";
import { ChatPanel } from "./features/chat/ChatPanel.jsx";
import { ToolDrawerInline, ToolDrawerOverlay } from "./features/chat/tool-drawer.jsx";
import { ToolDrawerProvider } from "./features/chat/tool-drawer-context.jsx";
import { FinancialContextDrawer } from "./features/context-panel/FinancialContextPanel.jsx";
import { SessionDrawer, SessionSidebar } from "./features/sessions/SessionHistory.jsx";
import { routeSessionView, shouldStartFreshHomeSession } from "./features/sessions/route-session-state.js";
import { useChatRun } from "./hooks/useChatRun.jsx";
import { useGuiConnection } from "./hooks/useGuiConnection.jsx";

const loadCatalogOverlay = () => import("./features/catalog/CatalogOverlay.jsx");
const CatalogOverlay = lazy(() => loadCatalogOverlay().then((module) => ({ default: module.CatalogOverlay })));

const CATALOG_DRAWERS = new Set(["catalog", "tools", "workflows", "providers"]);

export function AppShell() {
  const navigate = useNavigate();
  const location = useRouterState({ select: (state) => state.location });
  const gui = useGuiConnection();
  const [liveEvents, setLiveEvents] = useState([]);
  const [liveBaseEntryCount, setLiveBaseEntryCount] = useState(0);
  const chatRun = useChatRun({
    setToast: gui.setToast,
    onRunStart: useCallback(() => {
      setLiveBaseEntryCount(gui.entries.length);
      setLiveEvents([]);
    }, [gui.entries.length]),
    onEvent: useCallback((event) => {
      setLiveEvents((current) => [...current, event]);
      if (event.type !== "run.started" || !event.sessionId) return;
      const sessionId = String(event.sessionId);
      const sessionPath = `/sessions/${encodeURIComponent(sessionId)}`;
      if (location.pathname === sessionPath) return;
      void navigate({
        to: "/sessions/$sessionId",
        params: { sessionId },
        search: (current) => ({ ...current, drawer: undefined }),
      });
    }, [location.pathname, navigate]),
  });
  const activeDrawer = location.search?.drawer;
  const catalogOpen = CATALOG_DRAWERS.has(activeDrawer);
  const sessionsOpen = activeDrawer === "history" || location.pathname === "/history";
  const contextOpen = activeDrawer === "context";
  const sessionView = routeSessionView({
    pathname: location.pathname,
    currentSessionId: gui.currentSessionId,
    entries: gui.entries,
    runState: chatRun.runState,
    liveBaseEntryCount,
  });
  const visibleAskUserPrompts = gui.askUserPrompts.filter((prompt) =>
    !prompt.sessionId || prompt.sessionId === sessionView.activeSessionId
  );
  const inputDisabled = gui.role !== "writer"
    || sessionView.pendingFreshHomeSession
    || sessionView.pendingSessionSwitch;
  // Composer draft is lifted here so the catalog can pre-fill it via fillComposer.
  const [draft, setDraft] = useState("");
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const homeResetSessionRef = useRef("");

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
    if (location.pathname !== "/") {
      homeResetSessionRef.current = "";
      return;
    }
    if (!shouldStartFreshHomeSession({
      pathname: location.pathname,
      role: gui.role,
      currentSessionId: gui.currentSessionId,
      entryCount: gui.entries.length,
      lastResetSessionId: homeResetSessionRef.current,
    })) return;
    homeResetSessionRef.current = gui.currentSessionId;
    gui.send("session.new");
  }, [location.pathname, gui.role, gui.currentSessionId, gui.entries.length, gui.send]);

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

  const startRoutedChatRun = useCallback((prompt) => {
    void chatRun.startChatRun(prompt);
  }, [chatRun.startChatRun]);

  const newSession = useCallback(() => {
    gui.send("session.new");
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
  return (
    <ToolDrawerProvider>
      <div className="flex overflow-hidden bg-background" style={{ height: "100dvh" }}>
        <SessionSidebar {...sidebarProps} />
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
        <ToolDrawerInline />
      </div>
      <ToolDrawerOverlay />
      <SessionDrawer open={sessionsOpen} {...sidebarProps} onClose={closeDrawer} />
      <FinancialContextDrawer
        open={contextOpen}
        state={gui.dashboard}
        catalog={gui.catalog}
        onClose={closeDrawer}
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
    </ToolDrawerProvider>
  );
}
