import { useNavigate, useRouterState } from "@tanstack/react-router";
import { lazy, Suspense, useCallback, useEffect, useRef, useState } from "react";
import { Toaster } from "./components/ui/toaster.jsx";
import { ChatPanel } from "./features/chat/ChatPanel.jsx";
import { createOptimisticUserMessageEvents } from "./features/chat/optimistic-user-message.js";
import { ToolDrawerInline, ToolDrawerOverlay } from "./features/chat/tool-drawer.jsx";
import { ToolDrawerProvider } from "./features/chat/tool-drawer-context.jsx";
import { AppContentArea } from "./features/layout/AppShellChrome.jsx";
import { MarketStatePage } from "./features/market-state/MarketStatePage.jsx";
import {
  chatRunSessionTarget,
  hasSessionContent,
  routeSessionView,
  sessionIdFromPath,
  shouldStartFreshHomeSession,
} from "./features/sessions/route-session-state.js";
import { SessionDrawer, SessionSidebar } from "./features/sessions/SessionHistory.jsx";
import { SettingsPage } from "./features/settings/SettingsPage.jsx";
import SymbolPage from "./features/symbol/SymbolPage.jsx";
import { useChatRun } from "./hooks/useChatRun.jsx";
import { useGuiConnection } from "./hooks/useGuiConnection.jsx";
import { appPageFromPath, domainFromPath, tickerFromPath } from "./route-resolution.js";
import { actionSurfaceRole } from "./runtime/runtime-transport.js";

const loadCatalogOverlay = () => import("./features/catalog/CatalogOverlay.jsx");
const CatalogOverlay = lazy(() =>
  loadCatalogOverlay().then((module) => ({ default: module.CatalogOverlay })),
);

// The catalog is a run surface: workflows and tools. `providers` stays an
// accepted drawer value so old links resolve, but it now redirects to Settings.
const CATALOG_DRAWERS = new Set(["catalog", "tools", "workflows"]);

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
  const hasGuiSessionContent = hasSessionContent(visibleEvents);
  const canPrepareFreshHomeSession =
    gui.role === "writer" &&
    gui.supportsSessionActions &&
    !search?.messageId &&
    chatRun.runState !== "connecting" &&
    chatRun.runState !== "streaming";
  const shouldPrepareFreshHomeSession = shouldStartFreshHomeSession({
    pathname,
    currentSessionId: gui.currentSessionId,
    entryCount: hasGuiSessionContent ? visibleEvents.length : 0,
    lastResetSessionId: homeResetSessionRef.current,
    canStartFreshHomeSession: canPrepareFreshHomeSession && gui.currentSessionPersisted,
  });
  const sessionView = routeSessionView({
    pathname,
    currentSessionId:
      routeSessionId && visibleSessionSnapshot ? routeSessionId : gui.currentSessionId,
    events: visibleEvents,
    runState: chatRun.runState,
    liveBaseEventCount: liveBaseEventCountBySession[activeSessionId] || 0,
    canStartFreshHomeSession: canPrepareFreshHomeSession,
    pendingFreshHomeSession: shouldPrepareFreshHomeSession,
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

  // Every deliberate route into key management lands on the same page: the
  // composer chip's manage item and the transcript's "Fix model key" CTA. The
  // first-run onboarding dialog is separate and stays a dialog.
  const openModelSettings = useCallback(() => {
    void navigate({
      to: "/settings/$section",
      params: { section: "model" },
      search: (current) => ({ ...current, drawer: undefined }),
    });
  }, [navigate]);

  const openProviderSettings = useCallback(
    (providerId, options = {}) => {
      void navigate({
        to: "/settings/$section",
        params: { section: "providers" },
        search: (current) => ({
          ...current,
          drawer: undefined,
          provider: providerId || undefined,
        }),
        ...options,
      });
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

  // Data providers left the catalog for Settings. Links written against the old
  // drawer grammar, including the catalog links that named a provider, land on
  // the provider row itself instead of a sheet that no longer has that tab.
  useEffect(() => {
    const providerId = search?.provider;
    const wantsProviders =
      activeDrawer === "providers" || (activeDrawer === "catalog" && Boolean(providerId));
    if (!wantsProviders) return;
    openProviderSettings(providerId, { replace: true });
  }, [activeDrawer, search?.provider, openProviderSettings]);

  // Diagnostics now lives inside Settings. The old path keeps working and
  // rewrites itself to the canonical one, so a bookmark lands on the same
  // content and back does not bounce between the two URLs.
  useEffect(() => {
    if (pathname !== "/diagnostics") return;
    void navigate({
      to: "/settings/$section",
      params: { section: "diagnostics" },
      search: (current) => ({ ...current }),
      replace: true,
    });
  }, [navigate, pathname]);

  useEffect(() => {
    if (pathname !== "/") {
      homeResetSessionRef.current = "";
      return;
    }
    if (!shouldPrepareFreshHomeSession) return;
    homeResetSessionRef.current = gui.currentSessionId;
    void createFreshHomeSession().then((sessionId) => {
      if (sessionId) homeResetSessionRef.current = sessionId;
    });
  }, [pathname, gui.currentSessionId, createFreshHomeSession, shouldPrepareFreshHomeSession]);

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
      // A freshly opened follower can render the home dashboard before it has
      // received a current session projection. Give its first submission a
      // durable session instead of passing an empty id into useChatRun and
      // silently dropping the prompt while writer ownership changes.
      const needsInitialHomeSession = target.mode === "current" && !activeSessionId;
      if (target.mode === "current" && !needsInitialHomeSession) {
        void chatRun.startChatRun(prompt, options);
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

  // Pages outside chat have no composer of their own, so a prompt handed over
  // from one of them opens chat first and lands in the same draft the catalog
  // fills. Nothing is sent: the reader still submits.
  const prefillComposerFromPage = useCallback(
    (text) => {
      openHome();
      fillComposer(text);
    },
    [openHome, fillComposer],
  );

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

  const initialCatalogTab = activeDrawer === "tools" ? "tools" : "workflows";
  const appPage = appPageFromPath(pathname);
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
        <AppContentArea>
          {appPage.page === "settings" ? (
            <SettingsPage
              section={appPage.section}
              role={gui.role}
              modelSetup={gui.modelSetup}
              catalog={gui.catalog}
              focusProvider={search?.provider}
              preferencesSnapshot={gui.preferencesSnapshot}
              dataQuality={visibleDashboard?.dataQuality}
              send={gui.send}
              onOpenProviders={openProviderSettings}
              onOpenModelSetup={openModelSettings}
              onOpenSidebar={() => openDrawer("history")}
              sidebarCollapsed={sidebarCollapsed}
              onExpandSidebar={() => setSidebarCollapsed(false)}
              onOpenHome={openHome}
              setToast={gui.setToast}
            />
          ) : ticker ? (
            <SymbolPage
              ticker={ticker}
              fillComposer={prefillComposerFromPage}
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
              alertThreshold={search?.alertThreshold}
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
              onOpenModelSetup={openModelSettings}
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
        </AppContentArea>
        <ToolDrawerInline />
      </div>
      <ToolDrawerOverlay />
      <SessionDrawer open={sessionsOpen} {...sidebarProps} onClose={closeDrawer} />
      <Suspense fallback={null}>
        {catalogOpen ? (
          <CatalogOverlay
            open={catalogOpen}
            initialTab={initialCatalogTab}
            catalog={gui.catalog}
            onClose={closeDrawer}
            setToast={gui.setToast}
            startChatRun={startRoutedChatRun}
            invokeTool={runCatalogTool}
            fillComposer={fillComposer}
            sessionId={sessionView.activeSessionId}
          />
        ) : null}
      </Suspense>
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
