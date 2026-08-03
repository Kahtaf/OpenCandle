import { useNavigate, useRouterState } from "@tanstack/react-router";
import { lazy, Suspense, useCallback, useEffect, useRef, useState } from "react";
import { Toaster } from "./components/ui/toaster.jsx";
import { ChatPanel } from "./features/chat/ChatPanel.jsx";
import { createOptimisticUserMessageEvents } from "./features/chat/optimistic-user-message.js";
import { ToolDrawerInline, ToolDrawerOverlay } from "./features/chat/tool-drawer.jsx";
import { ToolDrawerProvider } from "./features/chat/tool-drawer-context.jsx";
import { DiagnosticsPage } from "./features/diagnostics/DiagnosticsPage.jsx";
import { MarketStatePage } from "./features/market-state/MarketStatePage.jsx";
import { ModelSetupDialog } from "./features/onboarding/ModelSetupDialog.jsx";
import {
  chatRunSessionTarget,
  hasSessionContent,
  routeSessionView,
  sessionIdFromPath,
  shouldStartFreshHomeSession,
} from "./features/sessions/route-session-state.js";
import { SessionDrawer, SessionSidebar } from "./features/sessions/SessionHistory.jsx";
import SymbolPage from "./features/symbol/SymbolPage.jsx";
import { useChatRun } from "./hooks/useChatRun.jsx";
import { useGuiConnection } from "./hooks/useGuiConnection.jsx";
import { domainFromPath, tickerFromPath } from "./route-resolution.js";
import { actionSurfaceRole } from "./runtime/runtime-transport.js";

const loadCatalogOverlay = () => import("./features/catalog/CatalogOverlay.jsx");
const CatalogOverlay = lazy(() =>
  loadCatalogOverlay().then((module) => ({ default: module.CatalogOverlay })),
);

const CATALOG_DRAWERS = new Set(["catalog", "tools", "workflows", "providers"]);

export function AppShell() {
  const navigate = useNavigate();
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const search = useRouterState({ select: (state) => state.location.search });
  const gui = useGuiConnection();
  const routeSessionId = sessionIdFromPath(pathname);
  const activeSessionId = routeSessionId || gui.currentSessionId || "";
  const visibleSessionSnapshot = activeSessionId ? gui.sessionSnapshots[activeSessionId] : null;
  const visibleEvents = visibleSessionSnapshot?.events || gui.events;
  const visibleDashboard = visibleSessionSnapshot?.dashboard || gui.dashboard;
  const visibleEventCount = visibleEvents.length;
  const [liveEventsBySession, setLiveEventsBySession] = useState({});
  const [liveBaseEventCountBySession, setLiveBaseEventCountBySession] = useState({});
  const chatRun = useChatRun({
    activeSessionId,
    setToast: gui.setToast,
    onRunStart: useCallback(
      (prompt, baseEventCount, sessionId, optimistic = {}) => {
        const key = sessionId || activeSessionId;
        if (!key) return;
        const targetSnapshot = gui.sessionSnapshots[key];
        setLiveBaseEventCountBySession((current) => ({
          ...current,
          [key]: baseEventCount ?? targetSnapshot?.events?.length ?? visibleEventCount,
        }));
        setLiveEventsBySession((current) => ({
          ...current,
          [key]: createOptimisticUserMessageEvents(prompt, key, {
            attachments: optimistic.attachments,
          }),
        }));
      },
      [activeSessionId, gui.sessionSnapshots, visibleEventCount],
    ),
    onEvent: useCallback(
      (event, fallbackSessionId) => {
        const eventSessionId = String(event.sessionId || fallbackSessionId || activeSessionId);
        if (!eventSessionId) return;
        setLiveEventsBySession((current) => ({
          ...current,
          [eventSessionId]: [...(current[eventSessionId] || []), event],
        }));
        if (event.type !== "run.started" || !event.sessionId) return;
        const sessionId = String(event.sessionId);
        gui.adoptSessionId(sessionId);
        const sessionPath = `/sessions/${encodeURIComponent(sessionId)}`;
        if (routeSessionId || pathname === sessionPath) return;
        void navigate({
          to: "/sessions/$sessionId",
          params: { sessionId },
          search: (current) => ({ ...current, drawer: undefined }),
        });
      },
      [activeSessionId, pathname, routeSessionId, navigate, gui],
    ),
    onRunError: useCallback((sessionId) => {
      if (!sessionId) return;
      setLiveEventsBySession((current) => {
        if (!current[sessionId]) return current;
        const next = { ...current };
        delete next[sessionId];
        return next;
      });
      setLiveBaseEventCountBySession((current) => {
        if (!current[sessionId]) return current;
        const next = { ...current };
        delete next[sessionId];
        return next;
      });
    }, []),
  });
  const activeDrawer = search?.drawer;
  const catalogOpen = CATALOG_DRAWERS.has(activeDrawer);
  const sessionsOpen = activeDrawer === "history";
  // Composer draft is lifted here so the catalog can pre-fill it via fillComposer.
  const [draft, setDraft] = useState("");
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [modelSetupOpen, setModelSetupOpen] = useState(false);
  const homeResetSessionRef = useRef("");
  const homeSessionCreationRef = useRef(null);
  const freshRunPendingRef = useRef(false);
  const createFreshHomeSession = useCallback(() => {
    if (homeSessionCreationRef.current) return homeSessionCreationRef.current;
    const creation = gui.newSession();
    homeSessionCreationRef.current = creation;
    void creation.finally(() => {
      if (homeSessionCreationRef.current === creation) homeSessionCreationRef.current = null;
    });
    return creation;
  }, [gui.newSession]);
  const sessionView = routeSessionView({
    pathname,
    currentSessionId:
      routeSessionId && visibleSessionSnapshot ? routeSessionId : gui.currentSessionId,
    events: visibleEvents,
    runState: chatRun.runState,
    liveBaseEventCount: liveBaseEventCountBySession[activeSessionId] || 0,
    canStartFreshHomeSession:
      gui.role === "writer" && gui.supportsSessionActions && !search?.messageId,
  });
  const liveEvents = liveEventsBySession[sessionView.activeSessionId] || [];
  const liveBaseEventCount = liveBaseEventCountBySession[sessionView.activeSessionId] || 0;
  const nonChatActionsUnavailable =
    gui.coordination?.sessionId === sessionView.activeSessionId &&
    gui.coordination?.ownerKind === "tui";
  const visibleAskUserPrompts = nonChatActionsUnavailable
    ? []
    : gui.askUserPrompts.filter(
        (prompt) => !prompt.sessionId || prompt.sessionId === sessionView.activeSessionId,
      );
  const hasGuiSessionContent = hasSessionContent(visibleEvents);
  const guiEventCount = visibleEvents.length;
  const inputDisabled =
    sessionView.pendingSessionSwitch ||
    sessionView.pendingFreshHomeSession ||
    !gui.supportsSessionActions;
  const actionRole = actionSurfaceRole(gui.role, gui.supportsSessionActions);

  const openDrawer = useCallback(
    (drawer) => {
      void navigate({ search: (current) => ({ ...current, drawer }) });
    },
    [navigate],
  );

  const clearLiveEventsForSession = useCallback((sessionId) => {
    if (!sessionId) return;
    setLiveEventsBySession((current) => {
      if (!current[sessionId]) return current;
      const next = { ...current };
      delete next[sessionId];
      return next;
    });
    setLiveBaseEventCountBySession((current) => {
      if (!current[sessionId]) return current;
      const next = { ...current };
      delete next[sessionId];
      return next;
    });
  }, []);

  const closeDrawer = useCallback(() => {
    void navigate({
      search: (current) => ({ ...current, drawer: undefined, provider: undefined }),
    });
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
    if (!routeSessionId || visibleSessionSnapshot) return;
    void gui.loadSession(routeSessionId);
  }, [gui.loadSession, routeSessionId, visibleSessionSnapshot]);

  useEffect(() => {
    if (pathname !== "/") {
      homeResetSessionRef.current = "";
      return;
    }
    if (
      !shouldStartFreshHomeSession({
        pathname,
        currentSessionId: gui.currentSessionId,
        entryCount: hasGuiSessionContent ? guiEventCount : 0,
        lastResetSessionId: homeResetSessionRef.current,
        canStartFreshHomeSession:
          gui.role === "writer" && gui.supportsSessionActions && !search?.messageId,
      })
    )
      return;
    homeResetSessionRef.current = gui.currentSessionId;
    void createFreshHomeSession().then((sessionId) => {
      if (sessionId) homeResetSessionRef.current = sessionId;
    });
  }, [
    pathname,
    gui.currentSessionId,
    hasGuiSessionContent,
    guiEventCount,
    createFreshHomeSession,
    gui.role,
    gui.supportsSessionActions,
    search?.messageId,
  ]);

  useEffect(() => {
    if (
      liveEvents.length === 0 ||
      chatRun.runState === "connecting" ||
      chatRun.runState === "streaming"
    )
      return;
    if (visibleEvents.length <= liveBaseEventCount) return;
    clearLiveEventsForSession(sessionView.activeSessionId);
  }, [
    chatRun.runState,
    clearLiveEventsForSession,
    liveBaseEventCount,
    liveEvents.length,
    sessionView.activeSessionId,
    visibleEvents.length,
  ]);

  const openCatalog = useCallback(
    (target = "catalog", providerId) => {
      loadCatalogOverlay();
      const drawer = CATALOG_DRAWERS.has(target) ? target : "catalog";
      void navigate({
        search: (current) => ({ ...current, drawer, provider: providerId || undefined }),
      });
    },
    [navigate],
  );

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

  // Writer home sends run in a fresh session so a stale client cannot append to
  // the previous active session. Non-owner windows submit to the active session
  // and let the server proxy to the current coordinator when one is available.
  const startRoutedChatRun = useCallback(
    async (prompt, options = {}) => {
      const target = chatRunSessionTarget({
        pathname,
        supportsSessionActions: gui.supportsSessionActions,
        hasCurrentSessionContent: hasGuiSessionContent,
        canStartFreshHomeSession: gui.role === "writer",
      });
      if (target.mode === "current") {
        void chatRun.startChatRun(prompt, options);
        return;
      }
      if (target.mode === "route") {
        const result = await chatRun.startChatRun(prompt, {
          ...options,
          sessionId: target.sessionId,
        });
        if (result?.sessionChanged) {
          clearLiveEventsForSession(target.sessionId);
          gui.setToast("The active session changed before your message was sent. Please resend.", {
            destructive: true,
          });
        }
        return;
      }
      if (freshRunPendingRef.current) return;
      freshRunPendingRef.current = true;
      try {
        for (let attempt = 0; attempt < 2; attempt++) {
          const freshSessionId = await createFreshHomeSession();
          if (!freshSessionId) return;
          homeResetSessionRef.current = freshSessionId;
          const result = await chatRun.startChatRun(prompt, {
            ...options,
            sessionId: freshSessionId,
            baseEventCount: 0,
          });
          if (!result?.sessionChanged) return;
        }
        clearLiveEventsForSession(homeResetSessionRef.current || activeSessionId);
        gui.setToast("The active session changed before your message was sent. Please resend.", {
          destructive: true,
        });
      } finally {
        freshRunPendingRef.current = false;
      }
    },
    [
      activeSessionId,
      pathname,
      hasGuiSessionContent,
      gui.role,
      gui.supportsSessionActions,
      createFreshHomeSession,
      gui.setToast,
      chatRun.startChatRun,
      clearLiveEventsForSession,
    ],
  );

  const openHome = useCallback(() => {
    void navigate({ to: "/", search: (current) => ({ ...current, drawer: undefined }) });
  }, [navigate]);

  const newSession = useCallback(() => {
    void (async () => {
      const sessionId = await gui.newSession();
      if (!sessionId) return;
      setSidebarCollapsed(false);
      void navigate({
        to: "/sessions/$sessionId",
        params: { sessionId },
        search: (current) => ({ ...current, drawer: undefined }),
      });
    })();
  }, [gui, navigate]);

  const openSession = useCallback(
    (session) => {
      setSidebarCollapsed(false);
      void navigate({
        to: "/sessions/$sessionId",
        params: { sessionId: session.id },
        search: (current) => ({ ...current, drawer: undefined }),
      });
    },
    [navigate],
  );

  const renameSession = useCallback(
    (session, name) => {
      gui.send("session.rename", { path: session.path, name });
    },
    [gui],
  );

  const deleteSession = useCallback(
    (session) => {
      gui.send("session.delete", { path: session.path });
      if (session.id === sessionView.activeSessionId) {
        void navigate({ to: "/", search: (current) => ({ ...current, drawer: undefined }) });
      }
    },
    [gui, navigate, sessionView.activeSessionId],
  );

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
    onOpenHome: openHome,
  };

  const initialCatalogTab =
    activeDrawer === "tools"
      ? "tools"
      : activeDrawer === "providers"
        ? "providers"
        : activeDrawer === "workflows"
          ? "workflows"
          : "workflows";
  const ticker = tickerFromPath(pathname);
  const marketDomain = domainFromPath(pathname);
  const invokeToolForVisibleSession = useCallback(
    (toolName, args, targetSessionId, options) => {
      if (nonChatActionsUnavailable) {
        const message = "OpenCandle is reconnecting to this session.";
        gui.setToast(message);
        return Promise.reject(new Error(message));
      }
      return gui.invokeTool(
        toolName,
        args,
        targetSessionId ?? sessionView.activeSessionId,
        options,
      );
    },
    [gui.invokeTool, gui.setToast, nonChatActionsUnavailable, sessionView.activeSessionId],
  );
  const runCatalogTool = useCallback(
    async (toolName, args) => {
      const target = chatRunSessionTarget({
        pathname,
        supportsSessionActions: gui.supportsSessionActions,
        hasCurrentSessionContent: hasGuiSessionContent,
        canStartFreshHomeSession: gui.role === "writer",
      });
      let targetSessionId =
        target.mode === "route" ? target.sessionId : sessionView.activeSessionId;
      const routeToToolSession = async (sessionId) => {
        if (pathname !== "/") return;
        homeResetSessionRef.current = sessionId;
        gui.adoptSessionId(sessionId);
        await navigate({
          to: "/sessions/$sessionId",
          params: { sessionId },
          search: (current) => ({ ...current, drawer: undefined }),
        });
      };

      if (target.mode === "fresh") {
        if (freshRunPendingRef.current) {
          throw new Error("A new session is already being prepared. Please retry shortly.");
        }
        freshRunPendingRef.current = true;
        try {
          targetSessionId = await createFreshHomeSession();
          if (!targetSessionId) throw new Error("Unable to create a session for this tool run.");
          await routeToToolSession(targetSessionId);
          return invokeToolForVisibleSession(toolName, args, targetSessionId);
        } finally {
          freshRunPendingRef.current = false;
        }
      }

      if (!targetSessionId) throw new Error("Open a session before running this tool.");
      await routeToToolSession(targetSessionId);
      return invokeToolForVisibleSession(toolName, args, targetSessionId);
    },
    [
      pathname,
      gui.supportsSessionActions,
      gui.role,
      gui.adoptSessionId,
      hasGuiSessionContent,
      sessionView.activeSessionId,
      createFreshHomeSession,
      invokeToolForVisibleSession,
      navigate,
    ],
  );
  const scrollAnchorId = search?.messageId || search?.researchId || search?.synthesisId || "";

  return (
    <ToolDrawerProvider activeSessionId={sessionView.activeSessionId}>
      <div className="flex overflow-hidden bg-background" style={{ height: "100dvh" }}>
        <SessionSidebar {...sidebarProps} />
        <ConnectionStatusBanner role={gui.role} />
        {pathname === "/diagnostics" ? (
          <DiagnosticsPage
            role={gui.role}
            onOpenSidebar={() => openDrawer("history")}
            sidebarCollapsed={sidebarCollapsed}
            onExpandSidebar={() => setSidebarCollapsed(false)}
            onOpenProviders={(providerId) => openCatalog("providers", providerId)}
            onOpenModelSetup={() => setModelSetupOpen(true)}
            onOpenHome={openHome}
            setToast={gui.setToast}
            dataQuality={visibleDashboard?.dataQuality}
          />
        ) : ticker ? (
          <SymbolPage
            ticker={ticker}
            startChatRun={startRoutedChatRun}
            navigate={navigate}
            invokeTool={invokeToolForVisibleSession}
            role={actionRole}
            setToast={gui.setToast}
            onOpenSidebar={() => openDrawer("history")}
            onOpenHome={openHome}
            sidebarCollapsed={sidebarCollapsed}
            onExpandSidebar={() => setSidebarCollapsed(false)}
          />
        ) : marketDomain ? (
          <MarketStatePage
            domain={marketDomain}
            alertSymbol={search?.alertSymbol}
            role={actionRole}
            send={gui.send}
            invokeTool={invokeToolForVisibleSession}
            navigate={navigate}
            setToast={gui.setToast}
            onOpenSidebar={() => openDrawer("history")}
            onOpenHome={openHome}
            sidebarCollapsed={sidebarCollapsed}
            onExpandSidebar={() => setSidebarCollapsed(false)}
          />
        ) : (
          <ChatPanel
            events={sessionView.events}
            liveEvents={liveEvents}
            askUserPrompts={visibleAskUserPrompts}
            modelSetup={gui.modelSetup}
            role={gui.role}
            inputDisabled={inputDisabled}
            sessionLoading={sessionView.pendingSessionSwitch}
            runState={chatRun.runState}
            lastPrompt={chatRun.lastPrompt}
            catalog={gui.catalog}
            send={gui.send}
            startChatRun={startRoutedChatRun}
            stopRun={chatRun.stopRun}
            invokeTool={invokeToolForVisibleSession}
            setToast={gui.setToast}
            draft={draft}
            setDraft={setDraft}
            onOpenCommandPalette={openCatalog}
            onOpenModelSetup={() => setModelSetupOpen(true)}
            onOpenSidebar={() => openDrawer("history")}
            onOpenHome={openHome}
            sidebarCollapsed={sidebarCollapsed}
            onExpandSidebar={() => setSidebarCollapsed(false)}
            sessionId={sessionView.activeSessionId}
            scrollAnchorId={scrollAnchorId}
            dashboard={visibleDashboard}
            navigate={navigate}
          />
        )}
        <ToolDrawerInline />
      </div>
      <ToolDrawerOverlay />
      <SessionDrawer open={sessionsOpen} {...sidebarProps} onClose={closeDrawer} />
      <Suspense fallback={null}>
        {catalogOpen ? (
          <CatalogOverlay
            open={catalogOpen}
            initialTab={initialCatalogTab}
            initialProviderId={search?.provider}
            catalog={gui.catalog}
            onClose={closeDrawer}
            send={gui.send}
            setToast={gui.setToast}
            startChatRun={startRoutedChatRun}
            invokeTool={runCatalogTool}
            fillComposer={fillComposer}
            sessionId={sessionView.activeSessionId}
          />
        ) : null}
      </Suspense>
      <ModelSetupDialog
        open={modelSetupOpen}
        onOpenChange={setModelSetupOpen}
        modelSetup={gui.modelSetup}
        role={gui.role}
        send={gui.send}
        setToast={gui.setToast}
      />
      <Toaster />
    </ToolDrawerProvider>
  );
}

function ConnectionStatusBanner({ role }) {
  if (role !== "connecting" && role !== "disconnected") return null;
  const message =
    role === "connecting"
      ? "Connecting to the GUI session..."
      : "Reconnecting to the GUI session. Editing will resume automatically.";
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
