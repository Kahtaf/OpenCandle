import { ArrowDown, CircleHelp, Send, X } from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { reduceChatEvents } from "../../../../shared/event-reducer.ts";
import { ChatComposer } from "../../components/chat/chat-composer.jsx";
import { EmptyThread } from "../../components/chat/prompt-suggestions.jsx";
import {
  AssistantMessage,
  CustomMessage,
  UserMessage,
} from "../../components/chat/thread-message.jsx";
import { Button } from "../../components/ui/button.jsx";
import { Input } from "../../components/ui/input.jsx";
import { Skeleton } from "../../components/ui/skeleton.jsx";
import { StatusDot } from "../../components/ui/status-dot.jsx";
import { TextShimmer } from "../../components/ui/text-shimmer.jsx";
import { useMarketState } from "../../hooks/useMarketState.jsx";
import { cn } from "../../lib/utils.js";
import { DesktopSidebarRestore, MobileHeader } from "../layout/AppShellChrome.jsx";
import { ModelSetupCard } from "../onboarding/ModelSetupCard.jsx";
import { ToolResultCard } from "../renderers/ToolResultCard.jsx";
import { attachmentsForOptimisticMessage, attachmentsForRequest } from "./attachments.js";
import { chatRowsFromEvents } from "./chat-rows.js";
import { EntityPopover } from "./entity-popover.jsx";
import { collectSessionMarketFacts, enrichGroupedRows } from "./session-market-facts.js";
import { StepsCard } from "./steps-card.jsx";
import { useToolDrawer } from "./tool-drawer-context.jsx";
import { groupToolRuns } from "./tool-run-grouper.js";
import { useSymbolResolution } from "./use-symbol-resolution.js";

const EMPTY_KNOWN_SYMBOLS = [];

// React Doctor still flags this pre-existing shell as a giant component. New
// async symbol-resolution state lives in a hook while the broader split remains
// outside this review-focused change.
export function ChatPanel({
  events = [],
  liveEvents = [],
  askUserPrompts = [],
  modelSetup,
  role,
  inputDisabled = false,
  sessionLoading = false,
  runState,
  catalog,
  send,
  startChatRun,
  stopRun,
  invokeTool,
  setToast,
  draft: draftProp,
  setDraft: setDraftProp,
  onOpenCommandPalette,
  onOpenSidebar,
  onOpenHome,
  onOpenContext,
  sidebarCollapsed,
  onExpandSidebar,
  sessionId = "",
  scrollAnchorId = "",
  dashboard,
}) {
  // Allow App.jsx to lift draft state for cross-component pre-fill (e.g. catalog "Send to chat").
  // Falls back to local state when used standalone (older callers, tests).
  const [localDraft, setLocalDraft] = useState("");
  const [pendingAttachmentState, setPendingAttachmentState] = useState({
    sessionId,
    attachments: [],
  });
  const [allowToolAutoOpen, setAllowToolAutoOpen] = useState(false);
  const [selectedSymbol, setSelectedSymbol] = useState("");
  const [selectedSymbolAnchor, setSelectedSymbolAnchor] = useState(null);
  const symbolResolution = useSymbolResolution(selectedSymbol);
  const draft = draftProp !== undefined ? draftProp : localDraft;
  const setDraft = setDraftProp ?? setLocalDraft;
  const marketState = useMarketState();
  const liveState = useMemo(() => reduceChatEvents(liveEvents), [liveEvents]);
  const visibleRows = useMemo(
    () => chatRowsFromEvents(events, liveEvents, sessionId),
    [events, liveEvents, sessionId],
  );
  const rawGroupedRows = useMemo(() => groupToolRuns(visibleRows), [visibleRows]);
  const sessionMarketFacts = useMemo(
    () => collectSessionMarketFacts(rawGroupedRows),
    [rawGroupedRows],
  );
  const groupedRows = useMemo(
    () => enrichGroupedRows(rawGroupedRows, sessionMarketFacts),
    [rawGroupedRows, sessionMarketFacts],
  );
  const activity = useMemo(() => buildAgentActivity(liveState, runState), [liveState, runState]);
  const hasAskUserPrompts = askUserPrompts.length > 0;
  const autoOpenRunId = useMemo(() => {
    if (!allowToolAutoOpen) return null;
    const pendingRuns = groupedRows.filter(
      (row) => row.type === "tool_run" && row.status === "pending",
    );
    return pendingRuns[pendingRuns.length - 1]?.id ?? null;
  }, [allowToolAutoOpen, groupedRows]);
  const drawer = useToolDrawer();
  const drawerOpenForSession = Boolean(
    drawer.run && (!drawer.run.sessionId || drawer.run.sessionId === sessionId),
  );
  const transcript = useTranscriptScroller({
    rows: groupedRows,
    sessionId,
    scrollAnchorId,
    drawerOpen: drawerOpenForSession,
  });
  const rowAnchorId = scrollAnchorId || latestUserRowIdFromRows(groupedRows);
  const knownSymbols = useMemo(
    () => (Array.isArray(dashboard?.knownSymbols) ? dashboard.knownSymbols : []),
    [dashboard?.knownSymbols],
  );

  const onTranscriptClick = useCallback((event) => {
    const chip = event.target?.closest?.("[data-symbol]");
    const symbol = chip?.getAttribute?.("data-symbol");
    if (!symbol) return;
    event.preventDefault();
    const rect = chip.getBoundingClientRect?.();
    setSelectedSymbolAnchor(rect ? rectToPlainObject(rect) : null);
    setSelectedSymbol(symbol.toUpperCase());
  }, []);

  const addSelectedToWatchlist = useCallback(
    async (symbol) => {
      if (!symbol || !invokeTool) return;
      const saved = await invokeTool("manage_watchlist", { action: "add", symbol });
      if (saved) {
        await marketState.refresh();
        await marketState.refreshQuotes();
        setSelectedSymbol("");
      }
    },
    [invokeTool, marketState],
  );

  const askAboutSymbol = useCallback(
    (symbol) => {
      const text = `$${symbol} `;
      setDraft(text);
      setSelectedSymbol("");
      window.setTimeout(() => {
        const composer = document.getElementById("chat-composer");
        composer?.focus?.();
        if (composer instanceof HTMLTextAreaElement) {
          composer.setSelectionRange(text.length, text.length);
        }
      }, 0);
    },
    [setDraft],
  );
  // Keep the open drawer in sync as the active run streams in new steps.
  useEffect(() => {
    if (!drawer.run) return;
    if (drawer.run.sessionId && drawer.run.sessionId !== sessionId) {
      drawer.close();
      return;
    }
    const latest = groupedRows.find(
      (e) =>
        e.type === "tool_run" &&
        e.id === drawer.run.id &&
        (e.sessionId || "") === (drawer.run.sessionId || ""),
    );
    if (latest && latest !== drawer.run) drawer.open(latest);
  }, [groupedRows, drawer, sessionId]);
  if (
    allowToolAutoOpen &&
    !autoOpenRunId &&
    runState !== "connecting" &&
    runState !== "streaming"
  ) {
    setAllowToolAutoOpen(false);
  }
  const needsSetup = modelSetup?.requirement && modelSetup.requirement !== "ready";
  // Drafting stays available during first-run setup (shipped 0.11.0
  // behavior); needsSetup blocks only sending, via chatDisabled and submit.
  const composerDisabled = inputDisabled;
  const chatDisabled = composerDisabled || needsSetup;
  const canStopRun = runState === "connecting" || runState === "streaming";
  const pendingAttachments =
    pendingAttachmentState.sessionId === sessionId ? pendingAttachmentState.attachments : [];

  const submit = (value = draft) => {
    const prompt = String(value || "").trim();
    if (!prompt) return;
    if (needsSetup) {
      setToast?.("Connect or select an AI model before sending this message.");
      return;
    }
    if (chatDisabled) return;
    setAllowToolAutoOpen(true);
    setDraft("");
    const attachments = pendingAttachments;
    setPendingAttachmentState({ sessionId, attachments: [] });
    void startChatRun(prompt, {
      ...attachmentsForRequest(attachments),
      optimisticAttachments: attachmentsForOptimisticMessage(attachments),
    });
  };

  const addAttachment = useCallback(
    (attachment) => {
      setPendingAttachmentState((current) => ({
        sessionId,
        attachments:
          current.sessionId === sessionId ? [...current.attachments, attachment] : [attachment],
      }));
    },
    [sessionId],
  );

  const removeAttachment = useCallback(
    (index) => {
      setPendingAttachmentState((current) => ({
        sessionId,
        attachments:
          current.sessionId === sessionId
            ? current.attachments.filter((_, itemIndex) => itemIndex !== index)
            : [],
      }));
    },
    [sessionId],
  );

  const stop = () => {
    if (!canStopRun) return;
    stopRun?.(sessionId);
  };

  const placeholder = needsSetup
    ? "Draft a question, then connect a model to send"
    : "Ask anything";

  return (
    <section
      className="flex h-full min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-background"
      data-run-state={runState}
    >
      <MobileHeader onOpenSidebar={onOpenSidebar} onOpenHome={onOpenHome} />
      {sidebarCollapsed ? <DesktopSidebarRestore onExpandSidebar={onExpandSidebar} /> : null}
      <div className="relative min-h-0 flex-1">
        <section
          ref={transcript.viewportRef}
          className="h-full overflow-y-auto px-3 py-6 sm:px-6 md:px-12"
          data-chat-transcript
          data-scroll-anchor-id={scrollAnchorId || undefined}
          aria-label="Chat transcript"
          onScroll={transcript.onScroll}
          onWheel={transcript.onReaderIntent}
          onMouseDown={transcript.onReaderIntent}
          onTouchStart={transcript.onReaderIntent}
          onKeyDown={transcript.onReaderIntent}
          onClick={onTranscriptClick}
        >
          {needsSetup ? (
            <ModelSetupCard modelSetup={modelSetup} role={role} send={send} setToast={setToast} />
          ) : sessionLoading ? (
            <SessionLoadingState />
          ) : visibleRows.length === 0 && !activity && !hasAskUserPrompts ? (
            <EmptyThread
              onPrompt={submit}
              onOpenCatalog={onOpenCommandPalette}
              disabled={chatDisabled}
            />
          ) : (
            <div className="mx-auto flex w-full max-w-[1040px] flex-col gap-6">
              {groupedRows.map((entry) => (
                <MessageRow
                  key={entry.id}
                  entry={entry}
                  catalog={catalog}
                  autoOpenToolRun={entry.id === autoOpenRunId}
                  anchorRowId={rowAnchorId}
                  anchorRef={transcript.anchorRowRef}
                  knownSymbols={knownSymbols}
                />
              ))}
              {askUserPrompts.map((prompt) => (
                <AskUserPromptCard key={prompt.id} prompt={prompt} send={send} />
              ))}
              {activity ? <AgentActivity activity={activity} /> : null}
              <div ref={transcript.bottomRef} data-chat-bottom-sentinel aria-hidden="true" />
            </div>
          )}
        </section>
        {transcript.showJumpToLatest ? (
          <Button
            type="button"
            size="sm"
            rounded="full"
            className="absolute bottom-4 left-1/2 z-10 -translate-x-1/2 gap-1.5 shadow-subtle-md"
            onClick={transcript.jumpToLatest}
            aria-label="Jump to latest"
          >
            <ArrowDown className="h-4 w-4" />
            Latest
          </Button>
        ) : null}
      </div>
      <EntityPopover
        open={Boolean(selectedSymbol)}
        onOpenChange={(open) => {
          if (!open) {
            setSelectedSymbol("");
            setSelectedSymbolAnchor(null);
          }
        }}
        symbol={selectedSymbol}
        marketState={marketState.state}
        sessionMarketFacts={sessionMarketFacts}
        anchorRect={selectedSymbolAnchor}
        resolvedCandidate={symbolResolution.candidate}
        resolutionError={symbolResolution.error}
        resolving={symbolResolution.resolving}
        onAddToWatchlist={addSelectedToWatchlist}
        onAskAbout={askAboutSymbol}
      />
      <ChatComposer
        draft={draft}
        setDraft={setDraft}
        disabled={composerDisabled}
        setupBlocked={needsSetup}
        placeholder={placeholder}
        canSend={Boolean(draft.trim()) && !chatDisabled}
        canStop={canStopRun}
        onSubmit={() => submit()}
        onStop={stop}
        onOpenCatalog={() => onOpenCommandPalette?.("catalog")}
        onOpenContext={onOpenContext}
        modelSetup={modelSetup}
        role={role}
        send={send}
        setToast={setToast}
        pendingAttachments={pendingAttachments}
        onAddAttachment={addAttachment}
        onRemoveAttachment={removeAttachment}
      />
    </section>
  );
}

function rectToPlainObject(rect) {
  return {
    left: rect.left,
    right: rect.right,
    top: rect.top,
    bottom: rect.bottom,
    width: rect.width,
    height: rect.height,
  };
}

function useTranscriptScroller({ rows, sessionId, scrollAnchorId, drawerOpen }) {
  const viewportRef = useRef(null);
  const bottomRef = useRef(null);
  const [showJumpToLatest, setShowJumpToLatest] = useState(false);
  const followingRef = useRef(true);
  const previousSessionRef = useRef("");
  const previousLatestUserRef = useRef("");
  const appliedAnchorRef = useRef("");
  const pendingRowAnchorRef = useRef("");
  const latestUserRowId = useMemo(() => {
    for (let index = rows.length - 1; index >= 0; index -= 1) {
      if (rows[index].type === "user_message") return rows[index].id;
    }
    return "";
  }, [rows]);

  const updateJumpState = useCallback(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    setShowJumpToLatest(rows.length > 0 && !isNearBottom(viewport));
  }, [rows.length]);

  const scrollToBottom = useCallback(() => {
    const bottom = bottomRef.current;
    if (bottom) {
      bottom.scrollIntoView({ block: "end" });
      return;
    }
    const viewport = viewportRef.current;
    if (viewport) viewport.scrollTop = viewport.scrollHeight;
  }, []);

  const jumpToLatest = useCallback(() => {
    followingRef.current = true;
    scrollToBottom();
    setShowJumpToLatest(false);
  }, [scrollToBottom]);

  const anchorRowRef = useCallback(
    (node) => {
      if (!node) return;
      const anchorId = scrollAnchorId || latestUserRowId;
      if (!anchorId) return;
      const key = `${sessionId || ""}::${anchorId}`;
      window.setTimeout(() => {
        if (pendingRowAnchorRef.current !== key) return;
        const viewport = node.closest("[data-chat-transcript]");
        if (!(viewport instanceof HTMLElement)) return;
        positionRowElement(viewport, node);
        pendingRowAnchorRef.current = "";
        updateJumpState();
      }, 0);
    },
    [latestUserRowId, scrollAnchorId, sessionId, updateJumpState],
  );

  const onReaderIntent = useCallback(() => {
    const viewport = viewportRef.current;
    if (!viewport || isNearBottom(viewport)) return;
    followingRef.current = false;
    setShowJumpToLatest(rows.length > 0);
  }, [rows.length]);

  const onScroll = useCallback(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    if (isNearBottom(viewport)) {
      followingRef.current = true;
      setShowJumpToLatest(false);
      return;
    }
    setShowJumpToLatest(rows.length > 0);
  }, [rows.length]);

  useEffect(() => {
    if (!drawerOpen) return;
    followingRef.current = false;
    updateJumpState();
  }, [drawerOpen, updateJumpState]);

  useLayoutEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport || rows.length === 0) {
      setShowJumpToLatest(false);
      return;
    }

    const sessionChanged = previousSessionRef.current !== sessionId;
    const latestUserChanged = previousLatestUserRef.current !== latestUserRowId;
    const anchorKey = `${sessionId || ""}::${scrollAnchorId || ""}`;
    const hasNewExplicitAnchor = scrollAnchorId && appliedAnchorRef.current !== anchorKey;
    const pendingAnchorId = pendingTranscriptAnchorId({
      hasNewExplicitAnchor,
      scrollAnchorId,
      sessionChanged,
      latestUserChanged,
      latestUserRowId,
      following: followingRef.current,
    });
    if (pendingAnchorId) {
      pendingRowAnchorRef.current = `${sessionId || ""}::${pendingAnchorId}`;
    }

    previousSessionRef.current = sessionId;
    previousLatestUserRef.current = latestUserRowId;

    const positionTranscript = () => {
      const currentViewport = viewportRef.current;
      if (!currentViewport) return;

      if (hasNewExplicitAnchor) {
        if (scrollToRowAnchor(currentViewport, scrollAnchorId, sessionId)) {
          appliedAnchorRef.current = anchorKey;
          followingRef.current = false;
          pendingRowAnchorRef.current = "";
          updateJumpState();
          return;
        }
      }

      if (sessionChanged) {
        appliedAnchorRef.current = scrollAnchorId ? appliedAnchorRef.current : "";
        if (latestUserRowId && scrollToRowAnchor(currentViewport, latestUserRowId, sessionId)) {
          followingRef.current = true;
          pendingRowAnchorRef.current = "";
          updateJumpState();
          return;
        }
        followingRef.current = true;
        scrollToBottom();
        updateJumpState();
        return;
      }

      if (latestUserChanged && latestUserRowId && followingRef.current) {
        scrollToRowAnchor(currentViewport, latestUserRowId, sessionId);
        followingRef.current = true;
        pendingRowAnchorRef.current = "";
        updateJumpState();
        return;
      }

      if (followingRef.current || isNearBottom(currentViewport)) {
        scrollToBottom();
        setShowJumpToLatest(false);
        return;
      }

      updateJumpState();
    };

    positionTranscript();
    const timeout = window.setTimeout(positionTranscript, 0);
    return () => window.clearTimeout(timeout);
  }, [latestUserRowId, rows.length, scrollAnchorId, scrollToBottom, sessionId, updateJumpState]);

  return {
    viewportRef,
    bottomRef,
    anchorRowRef,
    showJumpToLatest,
    jumpToLatest,
    onReaderIntent,
    onScroll,
  };
}

function SessionLoadingState() {
  return (
    <div
      className="mx-auto flex w-full max-w-[1040px] flex-col gap-6"
      aria-label="Loading session"
      role="status"
    >
      <div className="grid max-w-[760px] gap-3">
        <Skeleton className="h-4 w-44" />
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-5/6" />
      </div>
      <div className="ml-auto grid w-full max-w-[720px] gap-3">
        <Skeleton className="h-4 w-36 justify-self-end" />
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-2/3 justify-self-end" />
      </div>
      <div className="grid max-w-[760px] gap-3">
        <Skeleton className="h-4 w-52" />
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-4/5" />
      </div>
    </div>
  );
}

function AskUserPromptCard({ prompt, send }) {
  const [draft, setDraft] = useState("");
  const pending = prompt.status === "pending";
  const disabled = !pending;
  const submit = (answer) => {
    const value = String(answer ?? draft).trim();
    if (!value || disabled) return;
    send("ask_user.answer", { id: prompt.id, sessionId: prompt.sessionId, answer: value });
    setDraft("");
  };
  const cancel = () => {
    if (!disabled) send("ask_user.cancel", { id: prompt.id, sessionId: prompt.sessionId });
  };

  return (
    <div className="max-w-[760px]">
      <div className="mb-1.5 flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground">
        <CircleHelp className="h-3.5 w-3.5" aria-hidden="true" />
        <span>
          {pending ? "Question" : prompt.status === "answered" ? "Answered" : "Cancelled"}
        </span>
      </div>
      <div className="rounded-lg border border-border bg-card px-3 py-3 shadow-subtle-xs">
        <div className="flex items-start gap-3">
          <span
            aria-hidden="true"
            className="mt-0.5 inline-flex size-7 shrink-0 items-center justify-center rounded-md border border-amber-700/40 bg-amber-100/70 text-amber-800 dark:border-amber-300/30 dark:bg-amber-950/40 dark:text-amber-300"
          >
            <CircleHelp className="size-4" />
          </span>
          <div className="min-w-0 flex-1">
            <div className="text-sm font-medium leading-relaxed text-foreground">
              {prompt.question}
            </div>
            {prompt.reason ? (
              <div className="mt-1 text-[12px] leading-relaxed text-muted-foreground">
                {prompt.reason}
              </div>
            ) : null}
            {prompt.status === "answered" ? (
              <div className="mt-2 rounded-md bg-secondary px-2 py-1.5 text-[12px] text-foreground">
                Answer: <span className="font-medium">{prompt.answer}</span>
              </div>
            ) : prompt.status === "cancelled" ? (
              <div className="mt-2 text-[12px] text-muted-foreground">
                The question was cancelled.
              </div>
            ) : (
              <AskUserPromptControls
                prompt={prompt}
                draft={draft}
                setDraft={setDraft}
                disabled={disabled}
                onSubmit={submit}
                onCancel={cancel}
              />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function AskUserPromptControls({ prompt, draft, setDraft, disabled, onSubmit, onCancel }) {
  if (prompt.questionType === "confirm") {
    return (
      <div className="mt-3 flex flex-wrap gap-2">
        <Button size="sm" disabled={disabled} onClick={() => onSubmit("Yes")}>
          Answer yes
        </Button>
        <Button size="sm" variant="bordered" disabled={disabled} onClick={() => onSubmit("No")}>
          Answer no
        </Button>
        <Button
          size="sm"
          variant="ghost"
          disabled={disabled}
          onClick={onCancel}
          aria-label="Cancel question"
        >
          <X />
        </Button>
      </div>
    );
  }

  if (prompt.questionType === "select") {
    const options = Array.isArray(prompt.options) ? prompt.options : [];
    return (
      <div className="mt-3 flex flex-wrap gap-2">
        {options.map((option) => (
          <Button
            key={option}
            size="sm"
            variant="bordered"
            disabled={disabled}
            onClick={() => onSubmit(option)}
          >
            {option}
          </Button>
        ))}
        <Button
          size="sm"
          variant="ghost"
          disabled={disabled}
          onClick={onCancel}
          aria-label="Cancel question"
        >
          <X />
        </Button>
      </div>
    );
  }

  return (
    <form
      className="mt-3 flex gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit(draft);
      }}
    >
      <Input
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        disabled={disabled}
        placeholder={prompt.placeholder || "Type an answer"}
        aria-label={prompt.question}
      />
      <Button
        type="submit"
        size="icon"
        disabled={disabled || !draft.trim()}
        aria-label="Send answer"
      >
        <Send />
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        disabled={disabled}
        onClick={onCancel}
        aria-label="Cancel question"
      >
        <X />
      </Button>
    </form>
  );
}

function AgentActivity({ activity }) {
  const hasThinking = Boolean(activity.thinkingText);

  return (
    <div className="max-w-[760px]">
      <div className="mb-1.5 flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground">
        <StatusDot status={activity.status} />
        <TextShimmer active={activity.status === "pending"}>
          {hasThinking ? "Analyzing" : "Working"}
        </TextShimmer>
      </div>
      {hasThinking ? (
        <div className="border-l border-dashed border-border pl-4 text-sm leading-relaxed text-muted-foreground">
          <div
            className={cn(
              "whitespace-pre-wrap",
              activity.status === "pending" && "max-h-32 overflow-hidden",
            )}
          >
            {compactThinkingText(activity.thinkingText)}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function MessageRow({
  entry,
  catalog,
  autoOpenToolRun = false,
  anchorRowId = "",
  anchorRef,
  knownSymbols = EMPTY_KNOWN_SYMBOLS,
}) {
  const messageId =
    entry.messageId || (String(entry.id || "").startsWith("message-") ? entry.id.slice(8) : "");
  const isAnchorRow =
    anchorRowId &&
    (entry.id === anchorRowId ||
      messageId === anchorRowId ||
      entry.id === `message-${anchorRowId}`);
  const row = (
    <div
      ref={isAnchorRow ? anchorRef : undefined}
      data-chat-row-id={entry.id}
      data-message-id={messageId || undefined}
      data-session-id={entry.sessionId || undefined}
      data-scroll-anchor={entry.type === "user_message" ? "true" : undefined}
      className="min-w-0 scroll-mt-6"
    >
      <MessageRowContent
        entry={entry}
        catalog={catalog}
        autoOpenToolRun={autoOpenToolRun}
        knownSymbols={knownSymbols}
      />
    </div>
  );
  return row;
}

function MessageRowContent({
  entry,
  catalog,
  autoOpenToolRun = false,
  knownSymbols = EMPTY_KNOWN_SYMBOLS,
}) {
  if (entry.type === "tool_run") {
    return <StepsCard run={entry} autoOpen={autoOpenToolRun} />;
  }
  if (entry.type === "custom_message") {
    return <CustomMessage customType={entry.customType} content={entry.content} />;
  }
  if (entry.type === "user_message")
    return (
      <UserMessage
        content={entry.content}
        attachments={entry.attachments}
        knownSymbols={knownSymbols}
      />
    );
  if (entry.type === "tool_result")
    return <ToolResultCard message={entry.message} catalog={catalog} />;
  if (entry.type === "assistant_message")
    return <AssistantMessage content={entry.content} knownSymbols={knownSymbols} />;
  return (
    <div className="rounded-lg border border-border bg-card p-4 text-sm">
      {JSON.stringify(entry)}
    </div>
  );
}

function isNearBottom(element) {
  return element.scrollHeight - element.scrollTop - element.clientHeight <= 48;
}

function latestUserRowIdFromRows(rows) {
  for (let index = rows.length - 1; index >= 0; index -= 1) {
    if (rows[index].type === "user_message") return rows[index].id;
  }
  return "";
}

export function pendingTranscriptAnchorId({
  hasNewExplicitAnchor = false,
  scrollAnchorId = "",
  sessionChanged = false,
  latestUserChanged = false,
  latestUserRowId = "",
  following = false,
} = {}) {
  if (hasNewExplicitAnchor) return scrollAnchorId;
  if (sessionChanged && latestUserRowId) return latestUserRowId;
  if (latestUserChanged && latestUserRowId && following) return latestUserRowId;
  return "";
}

function scrollToRowAnchor(viewport, anchorId, sessionId) {
  if (!anchorId) return false;
  const candidates = [...viewport.querySelectorAll("[data-chat-row-id]")];
  const target = candidates.find((element) => {
    if (sessionId && element.dataset.sessionId && element.dataset.sessionId !== sessionId) {
      return false;
    }
    const rowId = element.dataset.chatRowId || "";
    const messageId = element.dataset.messageId || "";
    return rowId === anchorId || messageId === anchorId || rowId === `message-${anchorId}`;
  });
  if (!target) return false;
  positionRowElement(viewport, target);
  return true;
}

function positionRowElement(viewport, row) {
  const top = Math.max(0, row.offsetTop - viewport.clientHeight * 0.12);
  viewport.scrollTo({ top, behavior: "auto" });
}

function buildAgentActivity(liveState, runState) {
  const isActive = runState === "connecting" || runState === "streaming";
  if (!isActive) return null;

  const runs = [...liveState.runs.values()];
  const activeRun = runs.find((run) => run.status === "running") || runs.at(-1);
  const thinking = activeRun ? thinkingForRun(liveState, activeRun) : undefined;
  const activeTool = [...liveState.tools.values()].some((tool) => tool.status === "running");
  const assistantText = liveState.messages.some(
    (message) => message.role === "assistant" && message.text.trim(),
  );

  if (!thinking?.text && (activeTool || assistantText)) return null;
  return {
    status: thinking?.status === "completed" ? "completed" : "pending",
    thinkingText: thinking?.text || "",
  };
}

function thinkingForRun(liveState, run) {
  const scopedKey = `${run.sessionId || ""}::${run.id}`;
  return (
    liveState.thinking.get(scopedKey) ||
    liveState.thinking.get(run.id) ||
    [...liveState.thinking.values()].find(
      (thinking) => thinking.runId === run.id && thinking.sessionId === run.sessionId,
    )
  );
}

function compactThinkingText(text) {
  const normalized = String(text || "")
    .trim()
    .replace(/\n{3,}/g, "\n\n");
  if (normalized.length <= 700) return normalized;
  return `${normalized.slice(0, 700).trimEnd()}...`;
}
