import { BarChart3, BookOpen, CandlestickChart, Menu } from "lucide-react";
import { useMemo, useState } from "react";
import { ChatComposer } from "../../components/chat/chat-composer.jsx";
import { EmptyThread } from "../../components/chat/prompt-suggestions.jsx";
import { AssistantMessage, CustomMessage, ToolCallMessage, UserMessage } from "../../components/chat/thread-message.jsx";
import { Button } from "../../components/ui/button.jsx";
import { textContent } from "../../rendering/text.js";
import { ToolResultCard } from "../renderers/ToolResultCard.jsx";
import { ModelSetupCard } from "../onboarding/ModelSetupCard.jsx";
import { eventsToLiveEntries } from "./live-entries.js";

export function ChatPanel({ entries, liveEvents, modelSetup, role, runState, lastPrompt, catalog, send, startChatRun, stopRun, retryRun, setToast, draft: draftProp, setDraft: setDraftProp, onOpenCommandPalette, onOpenSidebar, onOpenContext }) {
  // Allow App.jsx to lift draft state for cross-component pre-fill (e.g. catalog "Send to chat").
  // Falls back to local state when used standalone (older callers, tests).
  const [localDraft, setLocalDraft] = useState("");
  const draft = draftProp !== undefined ? draftProp : localDraft;
  const setDraft = setDraftProp ?? setLocalDraft;
  const liveEntries = useMemo(() => eventsToLiveEntries(liveEvents), [liveEvents]);
  const visibleEntries = useMemo(() => compactDuplicateUserMessages([...entries, ...liveEntries].filter(isVisibleEntry)), [entries, liveEntries]);
  const needsSetup = modelSetup?.requirement && modelSetup.requirement !== "ready";
  const canStop = runState === "connecting" || runState === "streaming";
  const canRetry = runState === "failed" || (runState === "ready" && lastPrompt);

  const submit = (value = draft) => {
    const prompt = String(value || "").trim();
    if (!prompt) return;
    setDraft("");
    void startChatRun(prompt);
  };

  const copyLastAssistant = () => {
    const assistant = [...entries].reverse().find((entry) => entry.type === "message" && entry.message?.role === "assistant");
    const text = assistant ? textContent(assistant.message.content) : "";
    if (!text) {
      setToast("No assistant response to copy.");
      return;
    }
    navigator.clipboard?.writeText(text).then(() => setToast("Copied latest response.")).catch(() => setToast("Copy failed."));
  };

  const placeholder = role === "follower"
    ? "Follower mode: take over this session to send"
    : "Ask anything";

  return (
    <section className="flex h-full min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-background">
      <MobileHeader onOpenSidebar={onOpenSidebar} onOpenContext={onOpenContext} onOpenCatalog={() => onOpenCommandPalette?.("catalog")} />
      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-6 sm:px-6 md:px-12">
        {needsSetup ? (
          <ModelSetupCard modelSetup={modelSetup} send={send} setToast={setToast} />
        ) : visibleEntries.length === 0 ? (
          <EmptyThread onPrompt={submit} onOpenCatalog={onOpenCommandPalette} />
        ) : (
          <div className="mx-auto flex max-w-[760px] flex-col gap-6">
            {visibleEntries.map((entry) => <MessageRow key={entry.id} entry={entry} catalog={catalog} />)}
          </div>
        )}
      </div>
      <ChatComposer
        draft={draft}
        setDraft={setDraft}
        disabled={role === "follower"}
        placeholder={placeholder}
        canSend={Boolean(draft.trim()) && role !== "follower"}
        canStop={canStop}
        canRetry={canRetry}
        onSubmit={() => submit()}
        onStop={stopRun}
        onRetry={retryRun}
        onCopy={copyLastAssistant}
        onOpenCommandPalette={onOpenCommandPalette}
      />
    </section>
  );
}

function MobileHeader({ onOpenSidebar, onOpenContext, onOpenCatalog }) {
  return (
    <header className="flex h-12 shrink-0 items-center gap-2 border-b border-border bg-background px-2 md:hidden">
      <Button variant="ghost" size="icon-sm" aria-label="Open sidebar" onClick={onOpenSidebar}>
        <Menu />
      </Button>
      <div className="flex items-center gap-1.5 text-sm font-semibold tracking-tight">
        <CandlestickChart className="h-4 w-4 text-foreground" strokeWidth={2.5} aria-hidden="true" />
        OpenCandle
      </div>
      <div className="ml-auto flex items-center">
        <Button variant="ghost" size="icon-sm" aria-label="Open catalog" onClick={onOpenCatalog}>
          <BookOpen />
        </Button>
        <Button variant="ghost" size="icon-sm" aria-label="Open context" onClick={onOpenContext}>
          <BarChart3 />
        </Button>
      </div>
    </header>
  );
}

function MessageRow({ entry, catalog }) {
  if (entry.type === "custom_message") {
    return <CustomMessage customType={entry.customType} content={entry.content} />;
  }
  const message = entry.message;
  if (message.role === "user") return <UserMessage content={message.content} />;
  if (message.role === "toolResult") return <ToolResultCard message={message} catalog={catalog} />;
  if (message.role === "assistant") {
    const toolCalls = message.content?.filter?.((part) => part.type === "toolCall") || [];
    const text = textContent(message.content);
    if (toolCalls.length && text) {
      return (
        <div className="grid gap-3">
          <AssistantMessage content={message.content} />
          <ToolCallMessage toolCalls={toolCalls} />
        </div>
      );
    }
    if (toolCalls.length) return <ToolCallMessage toolCalls={toolCalls} />;
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
