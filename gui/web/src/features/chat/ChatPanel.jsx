import { CircleHelp, Send, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
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
import { StatusDot } from "../../components/ui/status-dot.jsx";
import { TextShimmer } from "../../components/ui/text-shimmer.jsx";
import { cn } from "../../lib/utils.js";
import { DesktopSidebarRestore, MobileHeader } from "../layout/AppShellChrome.jsx";
import { ModelSetupCard } from "../onboarding/ModelSetupCard.jsx";
import { ToolResultCard } from "../renderers/ToolResultCard.jsx";
import { chatRowsFromEvents } from "./chat-rows.js";
import { StepsCard } from "./steps-card.jsx";
import { useToolDrawer } from "./tool-drawer-context.jsx";
import { groupToolRuns } from "./tool-run-grouper.js";

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
  setToast,
  draft: draftProp,
  setDraft: setDraftProp,
  onOpenCommandPalette,
  onOpenSidebar,
  onOpenHome,
  onOpenContext,
  sidebarCollapsed,
  onExpandSidebar,
}) {
  // Allow App.jsx to lift draft state for cross-component pre-fill (e.g. catalog "Send to chat").
  // Falls back to local state when used standalone (older callers, tests).
  const [localDraft, setLocalDraft] = useState("");
  const [allowToolAutoOpen, setAllowToolAutoOpen] = useState(false);
  const draft = draftProp !== undefined ? draftProp : localDraft;
  const setDraft = setDraftProp ?? setLocalDraft;
  const liveState = useMemo(() => reduceChatEvents(liveEvents), [liveEvents]);
  const visibleRows = useMemo(() => chatRowsFromEvents(events, liveEvents), [events, liveEvents]);
  const groupedRows = useMemo(() => groupToolRuns(visibleRows), [visibleRows]);
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
  // Keep the open drawer in sync as the active run streams in new steps.
  useEffect(() => {
    if (!drawer.run) return;
    const latest = groupedRows.find((e) => e.type === "tool_run" && e.id === drawer.run.id);
    if (latest && latest !== drawer.run) drawer.open(latest);
  }, [groupedRows, drawer]);
  if (
    allowToolAutoOpen &&
    !autoOpenRunId &&
    runState !== "connecting" &&
    runState !== "streaming"
  ) {
    setAllowToolAutoOpen(false);
  }
  const needsSetup = modelSetup?.requirement && modelSetup.requirement !== "ready";
  const chatDisabled = role === "follower" || inputDisabled || needsSetup;

  const submit = (value = draft) => {
    const prompt = String(value || "").trim();
    if (!prompt || chatDisabled) return;
    setAllowToolAutoOpen(true);
    setDraft("");
    void startChatRun(prompt);
  };

  const placeholder =
    role === "follower"
      ? "Follower mode: take over this session to send"
      : needsSetup
        ? "Complete model setup to chat"
        : "Ask anything";

  return (
    <section
      className="flex h-full min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-background"
      data-run-state={runState}
    >
      <MobileHeader onOpenSidebar={onOpenSidebar} onOpenHome={onOpenHome} />
      {sidebarCollapsed ? <DesktopSidebarRestore onExpandSidebar={onExpandSidebar} /> : null}
      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-6 sm:px-6 md:px-12">
        {needsSetup ? (
          <ModelSetupCard modelSetup={modelSetup} send={send} setToast={setToast} />
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
              />
            ))}
            {askUserPrompts.map((prompt) => (
              <AskUserPromptCard key={prompt.id} prompt={prompt} role={role} send={send} />
            ))}
            {activity ? <AgentActivity activity={activity} /> : null}
          </div>
        )}
      </div>
      <ChatComposer
        draft={draft}
        setDraft={setDraft}
        disabled={chatDisabled}
        placeholder={placeholder}
        canSend={Boolean(draft.trim()) && !chatDisabled}
        onSubmit={() => submit()}
        onOpenCatalog={() => onOpenCommandPalette?.("catalog")}
        onOpenContext={onOpenContext}
        modelSetup={modelSetup}
        send={send}
        setToast={setToast}
      />
    </section>
  );
}

function SessionLoadingState() {
  return (
    <div className="mx-auto flex h-full min-h-[320px] w-full max-w-[760px] items-center justify-center">
      <div className="grid gap-3 text-center">
        <TextShimmer className="text-sm font-medium text-muted-foreground">
          Loading session
        </TextShimmer>
        <div className="mx-auto h-1.5 w-36 overflow-hidden rounded-full bg-secondary">
          <div className="h-full w-1/2 animate-pulse rounded-full bg-muted-foreground/30" />
        </div>
      </div>
    </div>
  );
}

function AskUserPromptCard({ prompt, role, send }) {
  const [draft, setDraft] = useState("");
  const pending = prompt.status === "pending";
  const disabled = role === "follower" || !pending;
  const submit = (answer) => {
    const value = String(answer ?? draft).trim();
    if (!value || disabled) return;
    send("ask_user.answer", { id: prompt.id, answer: value });
    setDraft("");
  };
  const cancel = () => {
    if (!disabled) send("ask_user.cancel", { id: prompt.id });
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

function MessageRow({ entry, catalog, autoOpenToolRun = false }) {
  if (entry.type === "tool_run") {
    return <StepsCard run={entry} autoOpen={autoOpenToolRun} />;
  }
  if (entry.type === "custom_message") {
    return <CustomMessage customType={entry.customType} content={entry.content} />;
  }
  if (entry.type === "user_message") return <UserMessage content={entry.content} />;
  if (entry.type === "tool_result")
    return <ToolResultCard message={entry.message} catalog={catalog} />;
  if (entry.type === "assistant_message") return <AssistantMessage content={entry.content} />;
  return (
    <div className="rounded-lg border border-border bg-card p-4 text-sm">
      {JSON.stringify(entry)}
    </div>
  );
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
