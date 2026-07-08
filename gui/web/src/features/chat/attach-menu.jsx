import { Image, Newspaper, PieChart, Plus, WalletCards, X } from "lucide-react";
import { useRef, useState } from "react";
import { Button } from "../../components/ui/button.jsx";
import { attachmentLabel, attachmentsFromImageFiles, validateImageFiles } from "./attachments.js";

export function AttachMenu({ disabled, pendingAttachments, onAddAttachment, setToast }) {
  const [open, setOpen] = useState(false);
  const inputRef = useRef(null);

  const imageCount = pendingAttachments.filter((attachment) => attachment.kind === "image").length;

  async function onFilesSelected(event) {
    const files = Array.from(event.target.files ?? []);
    event.target.value = "";
    const errors = validateImageFiles(files, imageCount);
    if (errors.length > 0) {
      setToast?.(errors[0], { destructive: true });
      return;
    }
    for (const attachment of await attachmentsFromImageFiles(files)) {
      onAddAttachment?.(attachment);
    }
    setOpen(false);
  }

  return (
    <div className="relative">
      <Button
        variant="ghost"
        size="icon-sm"
        rounded="full"
        tooltip="Attach"
        aria-label="Attach context"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        disabled={disabled}
      >
        <span className="sr-only">Attach</span>
        <Plus />
      </Button>
      <input
        ref={inputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        multiple
        className="hidden"
        onChange={onFilesSelected}
      />
      {open ? (
        <div
          role="menu"
          className="absolute bottom-full left-0 z-20 mb-2 w-48 rounded-lg border border-border bg-popover p-1 text-sm shadow-subtle-md"
        >
          <AttachMenuItem
            icon={<Image />}
            label="Image..."
            onClick={() => inputRef.current?.click()}
          />
          <AttachMenuItem
            icon={<WalletCards />}
            label="Portfolio"
            onClick={() => {
              onAddAttachment?.({ kind: "portfolio", label: "Portfolio" });
              setOpen(false);
            }}
          />
          <AttachMenuItem
            icon={<PieChart />}
            label="Watchlist"
            onClick={() => {
              onAddAttachment?.({ kind: "watchlist", id: "default", label: "Watchlist" });
              setOpen(false);
            }}
          />
          <AttachMenuItem
            icon={<Newspaper />}
            label="Latest report"
            onClick={() => {
              onAddAttachment?.({ kind: "report", id: "latest", label: "Latest report" });
              setOpen(false);
            }}
          />
        </div>
      ) : null}
    </div>
  );
}

export function PendingAttachmentRail({ attachments, onRemoveAttachment }) {
  if (!attachments || attachments.length === 0) return null;
  return (
    <div className="flex gap-2 overflow-x-auto border-b border-dashed border-border px-3 py-2">
      {attachments.map((attachment, index) => (
        <div
          key={attachmentKey(attachment)}
          className="flex h-12 max-w-[180px] items-center gap-2 rounded-lg border border-border bg-background px-2 text-xs text-foreground"
        >
          {attachment.kind === "image" ? (
            <img
              src={`data:${attachment.mimeType};base64,${attachment.data}`}
              alt={attachment.name || "Attached image"}
              className="h-8 w-8 rounded-md object-cover"
            />
          ) : null}
          <span className="min-w-0 truncate">{attachmentLabel(attachment)}</span>
          <button
            type="button"
            className="ml-auto rounded-full p-1 text-muted-foreground hover:bg-secondary hover:text-foreground"
            aria-label={`Remove ${attachmentLabel(attachment)}`}
            onClick={() => onRemoveAttachment?.(index)}
          >
            <X className="h-3 w-3" aria-hidden="true" />
          </button>
        </div>
      ))}
    </div>
  );
}

function attachmentKey(attachment) {
  return [
    attachment.kind,
    attachment.id,
    attachment.name,
    attachment.label,
    attachment.mimeType,
    attachment.data,
  ]
    .filter(Boolean)
    .join(":");
}

function AttachMenuItem({ icon, label, onClick }) {
  return (
    <button
      type="button"
      role="menuitem"
      className="flex w-full items-center gap-2 rounded-md px-2 py-2 text-left hover:bg-secondary"
      onClick={onClick}
    >
      {icon ? <span className="[&>svg]:h-4 [&>svg]:w-4">{icon}</span> : null}
      <span>{label}</span>
    </button>
  );
}
