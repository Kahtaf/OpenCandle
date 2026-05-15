import { ArrowUp, BarChart3, Plus } from "lucide-react";
import { Button } from "../ui/button.jsx";
import { Textarea } from "../ui/textarea.jsx";
import { ModelSelector } from "../../features/chat/model-selector.jsx";

export function ChatComposer({
  draft,
  setDraft,
  disabled,
  placeholder,
  canSend,
  onSubmit,
  onOpenCatalog,
  onOpenContext,
  modelSetup,
  send,
  setToast,
}) {
  return (
    <div className="bg-background px-3 pb-4 pt-2 sm:px-6 md:px-12">
      <div className="mx-auto w-full max-w-[760px] rounded-2xl border border-border bg-card shadow-subtle-xs">
        <label className="sr-only" htmlFor="chat-composer">Message OpenCandle</label>
        <Textarea
          id="chat-composer"
          value={draft}
          disabled={disabled}
          placeholder={placeholder}
          className="min-h-[60px] rounded-2xl rounded-b-none px-4 py-3"
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "/" && !event.metaKey && !event.ctrlKey && !event.altKey && !draft.trim()) {
              event.preventDefault();
              onOpenCatalog?.();
              return;
            }
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              onSubmit();
            }
          }}
        />
        <div className="flex items-center gap-1 border-t border-dashed border-border px-2 py-2">
          <ModelSelector
            modelSetup={modelSetup}
            send={send}
            setToast={setToast}
            disabled={disabled}
          />
          <div className="ml-1 flex items-center">
            <Button
              variant="ghost"
              size="icon-sm"
              rounded="full"
              tooltip="Catalog"
              aria-label="Open catalog"
              onClick={() => onOpenCatalog?.()}
              disabled={disabled}
            >
              <Plus />
            </Button>
            <Button
              variant="ghost"
              size="icon-sm"
              rounded="full"
              tooltip="Context"
              aria-label="Open context"
              onClick={() => onOpenContext?.()}
              disabled={disabled}
            >
              <BarChart3 />
            </Button>
          </div>
          <div className="ml-auto">
            <Button
              variant={canSend ? "brand" : "secondary"}
              size="icon-sm"
              rounded="full"
              tooltip="Send message"
              aria-label="Send message"
              onClick={onSubmit}
              disabled={!canSend}
            >
              <ArrowUp />
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
