import { CandlestickChart, Menu, PanelLeftOpen } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { ChatComposer } from "../../components/chat/chat-composer.jsx";
import { EmptyThread } from "../../components/chat/prompt-suggestions.jsx";
import { AssistantMessage, CustomMessage, UserMessage } from "../../components/chat/thread-message.jsx";
import { Button } from "../../components/ui/button.jsx";
import { textContent } from "../../rendering/text.js";
import { ToolResultCard } from "../renderers/ToolResultCard.jsx";
import { ModelSetupCard } from "../onboarding/ModelSetupCard.jsx";
import { eventsToLiveEntries } from "./live-entries.js";
import { groupToolRuns } from "./tool-run-grouper.js";
import { StepsCard } from "./steps-card.jsx";
import { useToolDrawer } from "./tool-drawer-context.jsx";

export function ChatPanel({ entries, liveEvents, modelSetup, role, runState, catalog, send, startChatRun, setToast, draft: draftProp, setDraft: setDraftProp, onOpenCommandPalette, onOpenSidebar, onOpenContext, sidebarCollapsed, onExpandSidebar }) {
  // Allow App.jsx to lift draft state for cross-component pre-fill (e.g. catalog "Send to chat").
  // Falls back to local state when used standalone (older callers, tests).
  const [localDraft, setLocalDraft] = useState("");
  const draft = draftProp !== undefined ? draftProp : localDraft;
  const setDraft = setDraftProp ?? setLocalDraft;
  const liveEntries = useMemo(() => eventsToLiveEntries(liveEvents), [liveEvents]);
  const visibleEntries = useMemo(() => compactDuplicateUserMessages([...entries, ...liveEntries].filter(isVisibleEntry)), [entries, liveEntries]);
  const groupedEntries = useMemo(() => groupToolRuns(visibleEntries), [visibleEntries]);
  const drawer = useToolDrawer();
  // Keep the open drawer in sync as the active run streams in new steps.
  useEffect(() => {
    if (!drawer.run) return;
    const latest = groupedEntries.find((e) => e.type === "tool_run" && e.id === drawer.run.id);
    if (latest && latest !== drawer.run) drawer.open(latest);
  }, [groupedEntries, drawer]);
  const needsSetup = modelSetup?.requirement && modelSetup.requirement !== "ready";

  const submit = (value = draft) => {
    const prompt = String(value || "").trim();
    if (!prompt) return;
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
        ) : visibleEntries.length === 0 ? (
          <EmptyThread onPrompt={submit} onOpenCatalog={onOpenCommandPalette} />
        ) : (
          <div className="mx-auto flex max-w-[760px] flex-col gap-6">
            {groupedEntries.map((entry) => <MessageRow key={entry.id} entry={entry} catalog={catalog} />)}
          </div>
        )}
      </div>
      <ChatComposer
        draft={draft}
        setDraft={setDraft}
        disabled={role === "follower"}
        placeholder={placeholder}
        canSend={Boolean(draft.trim()) && role !== "follower"}
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
        <CandlestickChart className="h-4 w-4 text-foreground" strokeWidth={2.5} aria-hidden="true" />
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

function compactDuplicateUserMessages(entries) {
  const compacted = [];
  for (const entry of entries) {
    const previous = compacted[compacted.length - 1];
    if (entry.type === "message" && previous?.type === "message" && entry.message?.role === "user" && previous.message?.role === "user" && textContent(entry.message.content) === textContent(previous.message.content)) {
      continue;
    }
    compacted.push(entry);
  }
  return compacted;
}
