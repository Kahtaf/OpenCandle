import { ArrowUp, Eye, Square } from "lucide-react";
import { AttachMenu, PendingAttachmentRail } from "../../features/chat/attach-menu.jsx";
import {
  attachmentsFromImageFiles,
  imageFilesFromClipboardData,
  validateImageFiles,
} from "../../features/chat/attachments.js";
import { ModelSelector } from "../../features/chat/model-selector.jsx";
import { Button } from "../ui/button.jsx";
import { Textarea } from "../ui/textarea.jsx";

const EMPTY_ATTACHMENTS = [];

export function ChatComposer({
  draft,
  setDraft,
  disabled,
  setupBlocked,
  placeholder,
  canSend,
  canStop = false,
  onSubmit,
  onStop,
  onOpenCatalog,
  onOpenContext,
  modelSetup,
  role,
  send,
  setToast,
  pendingAttachments = EMPTY_ATTACHMENTS,
  onAddAttachment,
  onRemoveAttachment,
}) {
  const imageCount = pendingAttachments.filter((attachment) => attachment.kind === "image").length;

  async function onPaste(event) {
    if (disabled) return;
    const files = imageFilesFromClipboardData(event.clipboardData);
    if (files.length === 0) return;
    event.preventDefault();
    const errors = validateImageFiles(files, imageCount);
    if (errors.length > 0) {
      setToast?.(errors[0], { destructive: true });
      return;
    }
    for (const attachment of await attachmentsFromImageFiles(files)) {
      onAddAttachment?.(attachment);
    }
    setToast?.(files.length === 1 ? "Pasted image attached." : `Pasted ${files.length} images.`);
  }

  return (
    <div className="bg-background px-3 pb-4 pt-2 sm:px-6 md:px-12">
      <div className="mx-auto w-full max-w-[760px] rounded-2xl border border-border bg-card shadow-subtle-xs">
        <label className="sr-only" htmlFor="chat-composer">
          Message OpenCandle
        </label>
        <PendingAttachmentRail
          attachments={pendingAttachments}
          onRemoveAttachment={onRemoveAttachment}
        />
        <Textarea
          id="chat-composer"
          value={draft}
          disabled={disabled}
          placeholder={placeholder}
          className="min-h-[60px] rounded-2xl rounded-b-none px-4 py-3"
          onChange={(event) => setDraft(event.target.value)}
          onPaste={onPaste}
          onKeyDown={(event) => {
            if (
              event.key === "/" &&
              !event.metaKey &&
              !event.ctrlKey &&
              !event.altKey &&
              !draft.trim()
            ) {
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
            role={role}
            send={send}
            setToast={setToast}
            disabled={disabled}
          />
          <div className="ml-1 flex items-center">
            <AttachMenu
              disabled={disabled}
              pendingAttachments={pendingAttachments}
              onAddAttachment={onAddAttachment}
              onRemoveAttachment={onRemoveAttachment}
              setToast={setToast}
            />
            <Button
              variant="ghost"
              size="icon-sm"
              rounded="full"
              tooltip="What the agent sees"
              aria-label="What the agent sees"
              onClick={() => onOpenContext?.()}
              disabled={disabled}
            >
              <Eye />
            </Button>
          </div>
          <div className="ml-auto">
            <Button
              variant={canStop ? "secondary" : canSend ? "brand" : "secondary"}
              size="icon-sm"
              rounded="full"
              tooltip={
                canStop
                  ? "Stop response"
                  : setupBlocked
                    ? "Connect a model to send"
                    : "Send message"
              }
              aria-label={canStop ? "Stop response" : "Send message"}
              onClick={canStop ? onStop : onSubmit}
              disabled={canStop ? false : !canSend}
            >
              {canStop ? <Square /> : <ArrowUp />}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
