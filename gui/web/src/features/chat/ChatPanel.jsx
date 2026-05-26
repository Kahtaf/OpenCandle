import { CircleHelp, Menu, PanelLeftOpen, Send, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { OpenCandleLogo } from "../../components/brand/opencandle-logo.jsx";
import { ChatComposer } from "../../components/chat/chat-composer.jsx";
import { EmptyThread } from "../../components/chat/prompt-suggestions.jsx";
import { AssistantMessage, CustomMessage, UserMessage } from "../../components/chat/thread-message.jsx";
import { Button } from "../../components/ui/button.jsx";
import { Input } from "../../components/ui/input.jsx";
import { StatusDot } from "../../components/ui/status-dot.jsx";
import { TextShimmer } from "../../components/ui/text-shimmer.jsx";
import { reduceChatEvents } from "../../../../shared/event-reducer.ts";
import { cn } from "../../lib/utils.js";
import { ToolResultCard } from "../renderers/ToolResultCard.jsx";
import { ModelSetupCard } from "../onboarding/ModelSetupCard.jsx";
import { compactDuplicateUserMessages, eventsToLiveEntries } from "./live-entries.js";
import { groupToolRuns } from "./tool-run-grouper.js";
import { StepsCard } from "./steps-card.jsx";
import { useToolDrawer } from "./tool-drawer-context.jsx";

export function ChatPanel({ entries, liveEvents, askUserPrompts = [], modelSetup, role, inputDisabled = false, runState, catalog, send, startChatRun, setToast, draft: draftProp, setDraft: setDraftProp, onOpenCommandPalette, onOpenSidebar, onOpenContext, sidebarCollapsed, onExpandSidebar }) {
  // Allow App.jsx to lift draft state for cross-component pre-fill (e.g. catalog "Send to chat").
  // Falls back to local state when used standalone (older callers, tests).
  const [localDraft, setLocalDraft] = useState("");
  const draft = draftProp !== undefined ? draftProp : localDraft;
  const setDraft = setDraftProp ?? setLocalDraft;
  const liveState = useMemo(() => reduceChatEvents(liveEvents), [liveEvents]);
  const liveEntries = useMemo(() => eventsToLiveEntries(liveEvents), [liveEvents]);
  const visibleEntries = useMemo(() => compactDuplicateUserMessages([...entries, ...liveEntries].filter(isVisibleEntry)), [entries, liveEntries]);
  const groupedEntries = useMemo(() => groupToolRuns(visibleEntries), [visibleEntries]);
  const activity = useMemo(() => buildAgentActivity(liveState, runState), [liveState, runState]);
  const drawer = useToolDrawer();
  // Keep the open drawer in sync as the active run streams in new steps.
  useEffect(() => {
    if (!drawer.run) return;
    const latest = groupedEntries.find((e) => e.type === "tool_run" && e.id === drawer.run.id);
    if (latest && latest !== drawer.run) drawer.open(latest);
  }, [groupedEntries, drawer]);
  const needsSetup = modelSetup?.requirement && modelSetup.requirement !== "ready";
  const chatDisabled = role === "follower" || inputDisabled;

  const submit = (value = draft) => {
    const prompt = String(value || "").trim();
    if (!prompt || chatDisabled) return;
    setDraft("");
    void startChatRun(prompt);
  };

  const placeholder = role === "follower"
    ? "Follower mode: take over this session to send"
    : "Ask anything";

  return (
    <section className="flex h-full min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-background" data-run-state={runState}>
      <MobileHeader onOpenSidebar={onOpenSidebar} />
      {sidebarCollapsed ? <DesktopSidebarRestore onExpandSidebar={onExpandSidebar} /> : null}
      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-6 sm:px-6 md:px-12">
        {needsSetup ? (
          <ModelSetupCard modelSetup={modelSetup} send={send} setToast={setToast} />
        ) : visibleEntries.length === 0 && !activity ? (
          <EmptyThread onPrompt={submit} onOpenCatalog={onOpenCommandPalette} disabled={chatDisabled} />
        ) : (
          <div className="mx-auto flex w-full max-w-[1040px] flex-col gap-6">
            {groupedEntries.map((entry) => <MessageRow key={entry.id} entry={entry} catalog={catalog} />)}
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
        <span>{pending ? "Question" : prompt.status === "answered" ? "Answered" : "Cancelled"}</span>
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
            <div className="text-sm font-medium leading-relaxed text-foreground">{prompt.question}</div>
            {prompt.reason ? (
              <div className="mt-1 text-[12px] leading-relaxed text-muted-foreground">{prompt.reason}</div>
            ) : null}
            {prompt.status === "answered" ? (
              <div className="mt-2 rounded-md bg-secondary px-2 py-1.5 text-[12px] text-foreground">
                Answer: <span className="font-medium">{prompt.answer}</span>
              </div>
            ) : prompt.status === "cancelled" ? (
              <div className="mt-2 text-[12px] text-muted-foreground">The question was cancelled.</div>
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
        <Button size="sm" disabled={disabled} onClick={() => onSubmit("Yes")}>Yes</Button>
        <Button size="sm" variant="bordered" disabled={disabled} onClick={() => onSubmit("No")}>No</Button>
        <Button size="sm" variant="ghost" disabled={disabled} onClick={onCancel} aria-label="Cancel question">
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
          <Button key={option} size="sm" variant="bordered" disabled={disabled} onClick={() => onSubmit(option)}>
            {option}
          </Button>
        ))}
        <Button size="sm" variant="ghost" disabled={disabled} onClick={onCancel} aria-label="Cancel question">
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
      <Button type="submit" size="icon" disabled={disabled || !draft.trim()} aria-label="Send answer">
        <Send />
      </Button>
      <Button type="button" variant="ghost" size="icon" disabled={disabled} onClick={onCancel} aria-label="Cancel question">
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
        <TextShimmer active={activity.status === "pending"}>{hasThinking ? "Analyzing" : "Working"}</TextShimmer>
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

function DesktopSidebarRestore({ onExpandSidebar }) {
  return (
    <div className="hidden h-12 shrink-0 items-center border-b border-border bg-background px-3 md:flex">
      <Button variant="ghost" size="icon-sm" aria-label="Expand sidebar" onClick={onExpandSidebar}>
        <PanelLeftOpen />
      </Button>
    </div>
  );
}

function MobileHeader({ onOpenSidebar }) {
  return (
    <header className="flex h-12 shrink-0 items-center gap-2 border-b border-border bg-background px-2 md:hidden">
      <Button variant="ghost" size="icon-sm" aria-label="Open sidebar" onClick={onOpenSidebar}>
        <Menu />
      </Button>
      <div className="flex items-center gap-1.5 text-sm font-semibold tracking-tight">
        <OpenCandleLogo />
        OpenCandle
      </div>
    </header>
  );
}

function MessageRow({ entry, catalog }) {
  if (entry.type === "tool_run") {
    return <StepsCard run={entry} />;
  }
  if (entry.type === "custom_message") {
    return <CustomMessage customType={entry.customType} content={entry.content} />;
  }
  const message = entry.message;
  if (!message) return null;
  if (message.role === "user") return <UserMessage content={message.content} />;
  if (message.role === "toolResult") return <ToolResultCard message={message} catalog={catalog} />;
  if (message.role === "assistant") {
    // After grouping, assistant entries here are pure-text (their tool calls
    // were absorbed into the surrounding tool_run). Render only the text part.
    return <AssistantMessage content={message.content} />;
  }
  return <div className="rounded-lg border border-border bg-card p-4 text-sm">{JSON.stringify(message)}</div>;
}

function isVisibleEntry(entry) {
  if (entry.type === "custom_message") return true;
  if (entry.type !== "message") return false;
  return !isBackgroundToolEntry(entry.message);
}

function isBackgroundToolEntry(message) {
  if (message?.role === "toolResult") return message.details?.source === "background";
  if (message?.role !== "assistant") return false;
  return Boolean(message.content?.some?.((part) => part.type === "toolCall" && String(part.id || "").startsWith("background-")));
}

function buildAgentActivity(liveState, runState) {
  const isActive = runState === "connecting" || runState === "streaming";
  if (!isActive) return null;

  const runs = [...liveState.runs.values()];
  const activeRun = runs.find((run) => run.status === "running") || runs.at(-1);
  const thinking = activeRun ? liveState.thinking.get(activeRun.id) : undefined;
  const activeTool = [...liveState.tools.values()].some((tool) => tool.status === "running");
  const assistantText = liveState.messages.some((message) => message.role === "assistant" && message.text.trim());

  if (!thinking?.text && (activeTool || assistantText)) return null;
  return {
    status: thinking?.status === "completed" ? "completed" : "pending",
    thinkingText: thinking?.text || "",
  };
}

function compactThinkingText(text) {
  const normalized = String(text || "").trim().replace(/\n{3,}/g, "\n\n");
  if (normalized.length <= 700) return normalized;
  return `${normalized.slice(0, 700).trimEnd()}...`;
}
