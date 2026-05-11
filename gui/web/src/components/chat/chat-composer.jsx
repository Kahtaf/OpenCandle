import { ArrowUp, Copy, Globe, Paperclip, RefreshCcw, Square } from "lucide-react";
import { Button } from "../ui/button.jsx";
import { Textarea } from "../ui/textarea.jsx";

export function ChatComposer({ draft, setDraft, disabled, placeholder, canSend, canStop, canRetry, onSubmit, onStop, onRetry, onCopy, onOpenCommandPalette }) {
  return (
    <div className="bg-background px-3 pb-4 pt-2 sm:px-6 md:px-12">
      <div className="mx-auto w-full max-w-[760px] rounded-2xl border border-border bg-card shadow-subtle-xs">
        <label className="sr-only" htmlFor="chat-composer">Message OpenCandle</label>
        <Textarea
          id="chat-composer"
          value={draft}
          disabled={disabled}
          placeholder={placeholder}
          className="min-h-[60px] rounded-2xl px-4 py-3"
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "/" && !event.metaKey && !event.ctrlKey && !event.altKey && !draft.trim()) {
              event.preventDefault();
              onOpenCommandPalette?.();
              return;
            }
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              onSubmit();
            }
          }}
        />
        <div className="flex items-center gap-1 px-2 pb-2 pt-0.5">
          <Button variant="ghost" size="icon-sm" aria-label="Stop response" tooltip="Stop" onClick={onStop} disabled={!canStop}><Square /></Button>
          <Button variant="ghost" size="icon-sm" aria-label="Retry last prompt" tooltip="Retry" onClick={onRetry} disabled={!canRetry}><RefreshCcw /></Button>
          <Button variant="ghost" size="icon-sm" aria-label="Copy latest response" tooltip="Copy" onClick={onCopy}><Copy /></Button>
          <span className="ml-auto inline-flex items-center gap-1 text-muted-foreground">
            <Globe aria-hidden="true" className="hidden h-4 w-4 sm:inline" />
            <Paperclip aria-hidden="true" className="hidden h-4 w-4 sm:inline" />
          </span>
          <Button variant="brand" size="icon-sm" aria-label="Send message" onClick={onSubmit} disabled={!canSend}>
            <ArrowUp />
          </Button>
        </div>
      </div>
    </div>
  );
}
