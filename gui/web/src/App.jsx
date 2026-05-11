import { lazy, Suspense, useCallback, useEffect, useState } from "react";
import { useNavigate, useRouterState } from "@tanstack/react-router";
import { ChatPanel } from "./features/chat/ChatPanel.jsx";
import { FinancialContextDrawer } from "./features/context-panel/FinancialContextPanel.jsx";
import { SessionDrawer, SessionSidebar } from "./features/sessions/SessionHistory.jsx";
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
    onEvent: useCallback((event) => setLiveEvents((current) => [...current, event]), []),
  });
  const activeDrawer = location.search?.drawer;
  const catalogOpen = CATALOG_DRAWERS.has(activeDrawer);
  const sessionsOpen = activeDrawer === "history" || location.pathname === "/history";
  const contextOpen = activeDrawer === "context";
  const routeSessionId = sessionIdFromPath(location.pathname);
  // Composer draft is lifted here so the catalog can pre-fill it via fillComposer.
  const [draft, setDraft] = useState("");
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

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
    if (!routeSessionId || routeSessionId === gui.currentSessionId || gui.sessions.length === 0) return;
    const session = gui.sessions.find((candidate) => candidate.id === routeSessionId);
    if (session) gui.send("session.open", { path: session.path });
  }, [gui, routeSessionId]);

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

  const sidebarProps = {
    sessions: gui.sessions,
    currentSessionId: gui.currentSessionId,
    collapsed: sidebarCollapsed,
    onCollapse: () => setSidebarCollapsed(true),
    onOpenSession: openSession,
    onNewSession: newSession,
    onOpenCatalog: () => openCatalog("catalog"),
    onOpenContext: () => openDrawer("context"),
  };

  const initialCatalogTab = activeDrawer === "tools"
    ? "tools"
    : activeDrawer === "providers"
      ? "providers"
      : activeDrawer === "workflows"
        ? "workflows"
        : "workflows";

  return (
    <>
      <div className="flex overflow-hidden bg-background" style={{ height: "100dvh" }}>
        <SessionSidebar {...sidebarProps} />
        <ChatPanel
          entries={gui.entries}
          liveEvents={liveEvents}
          modelSetup={gui.modelSetup}
          role={gui.role}
          runState={chatRun.runState}
          lastPrompt={chatRun.lastPrompt}
          catalog={gui.catalog}
          send={gui.send}
          startChatRun={chatRun.startChatRun}
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
      </div>
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
            startChatRun={chatRun.startChatRun}
            fillComposer={fillComposer}
          />
        ) : null}
      </Suspense>
    </>
  );
}

function sessionIdFromPath(pathname) {
  const match = String(pathname || "").match(/^\/sessions\/([^/]+)$/);
  return match ? decodeURIComponent(match[1]) : "";
}
