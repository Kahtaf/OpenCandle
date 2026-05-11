import { ArrowUp } from "lucide-react";
import { Button } from "../ui/button.jsx";
import { Textarea } from "../ui/textarea.jsx";

export function ChatComposer({ draft, setDraft, disabled, placeholder, canSend, onSubmit, onOpenCommandPalette }) {
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
        <div className="flex items-center justify-end px-2 pb-2 pt-0.5">
          <Button variant="brand" size="icon-sm" aria-label="Send message" onClick={onSubmit} disabled={!canSend}>
            <ArrowUp />
          </Button>
        </div>
      </div>
    </div>
  );
}
