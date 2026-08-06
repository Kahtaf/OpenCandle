import { ArrowUp, Square } from "lucide-react";
import { useRef, useState } from "react";
import { AttachMenu, PendingAttachmentRail } from "../../features/chat/attach-menu.jsx";
import {
  attachmentsFromImageFiles,
  imageFilesFromClipboardData,
  validateImageFiles,
} from "../../features/chat/attachments.js";
import {
  CashtagAutocomplete,
  useCashtagAutocomplete,
} from "../../features/chat/cashtag-autocomplete.jsx";
import { insertAcceptedCashtag } from "../../features/chat/cashtag-autocomplete-helpers.js";
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
  modelSetup,
  send,
  setToast,
  pendingAttachments = EMPTY_ATTACHMENTS,
  attachmentsEnabled = true,
  portfolios,
  watchlists,
  onAddAttachment,
  onRemoveAttachment,
  onManageModelKeys,
}) {
  const imageCount = pendingAttachments.filter((attachment) => attachment.kind === "image").length;
  const textareaRef = useRef(null);
  const [caretIndex, setCaretIndex] = useState(0);
  const updateCaret = (target) => {
    if (target && typeof target.selectionStart === "number") setCaretIndex(target.selectionStart);
  };

  async function onPaste(event) {
    if (disabled || !attachmentsEnabled) return;
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

  const autocomplete = useCashtagAutocomplete({
    text: draft,
    caretIndex,
    disabled,
    onAccept: (symbol, match) => {
      const next = insertAcceptedCashtag(draft, match, symbol);
      setDraft(next.text);
      setCaretIndex(next.caretIndex);
      window.requestAnimationFrame(() => {
        const textarea = textareaRef.current;
        if (!textarea) return;
        textarea.focus();
        textarea.setSelectionRange(next.caretIndex, next.caretIndex);
      });
    },
  });

  return (
    <div className="bg-background px-3 pb-4 pt-2 sm:px-6 md:px-12">
      <div className="relative mx-auto w-full max-w-[760px] rounded-2xl border border-border bg-card shadow-subtle-xs">
        <CashtagAutocomplete controller={autocomplete} />
        <label className="sr-only" htmlFor="chat-composer">
          Message OpenCandle
        </label>
        {attachmentsEnabled ? (
          <PendingAttachmentRail
            attachments={pendingAttachments}
            onRemoveAttachment={onRemoveAttachment}
          />
        ) : null}
        <Textarea
          ref={textareaRef}
          id="chat-composer"
          value={draft}
          disabled={disabled}
          placeholder={placeholder}
          className="min-h-[60px] rounded-2xl rounded-b-none px-4 py-3"
          aria-controls={autocomplete.open ? "cashtag-autocomplete-list" : undefined}
          aria-autocomplete="list"
          onChange={(event) => {
            setDraft(event.target.value);
            updateCaret(event.target);
          }}
          onPaste={onPaste}
          onClick={(event) => updateCaret(event.currentTarget)}
          onKeyUp={(event) => updateCaret(event.currentTarget)}
          onKeyDown={(event) => {
            if (autocomplete.handleKeyDown(event)) return;
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
          <div className="[&>div>button]:h-10 [&>div>button]:min-h-10 md:[&>div>button]:h-7 md:[&>div>button]:min-h-0">
            <ModelSelector
              modelSetup={modelSetup}
              send={send}
              disabled={disabled}
              onManageKeys={onManageModelKeys}
            />
          </div>
          {attachmentsEnabled ? (
            <div className="ml-1 flex items-center [&>div>button]:h-11 [&>div>button]:w-11 md:[&>div>button]:h-8 md:[&>div>button]:w-8">
              <AttachMenu
                disabled={disabled}
                pendingAttachments={pendingAttachments}
                portfolios={portfolios}
                watchlists={watchlists}
                onAddAttachment={onAddAttachment}
                onRemoveAttachment={onRemoveAttachment}
                setToast={setToast}
              />
            </div>
          ) : null}
          <div className="ml-auto">
            <Button
              variant={canStop ? "secondary" : canSend ? "brand" : "secondary"}
              size="icon-sm"
              rounded="full"
              className="h-11 w-11 md:h-8 md:w-8"
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
