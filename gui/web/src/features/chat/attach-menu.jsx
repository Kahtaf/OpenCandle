import { Image, Newspaper, PieChart, Plus, WalletCards, X } from "lucide-react";
import { useRef, useState } from "react";
import { Button } from "../../components/ui/button.jsx";
import {
  Popover,
  PopoverAnchor,
  PopoverContent,
  PopoverTrigger,
} from "../../components/ui/popover.jsx";
import { attachmentLabel, attachmentsFromImageFiles, validateImageFiles } from "./attachments.js";
import {
  normalizePortfolioOptions,
  normalizeWatchlistOptions,
  portfolioAttachmentForOption,
  watchlistAttachmentForOption,
} from "./watchlist-options.js";

export function AttachMenu({
  disabled,
  pendingAttachments,
  portfolios,
  watchlists,
  onAddAttachment,
  setToast,
}) {
  const [open, setOpen] = useState(false);
  const inputRef = useRef(null);

  const imageCount = pendingAttachments.filter((attachment) => attachment.kind === "image").length;
  const portfolioOptions = normalizePortfolioOptions(portfolios);
  const watchlistOptions = normalizeWatchlistOptions(watchlists);

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
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverAnchor className="relative">
        <PopoverTrigger asChild>
          <Button
            variant="ghost"
            size="icon-sm"
            rounded="full"
            title="Attach"
            aria-label="Attach context"
            disabled={disabled}
          >
            <span className="sr-only">Attach</span>
            <Plus />
          </Button>
        </PopoverTrigger>
        <input
          ref={inputRef}
          type="file"
          accept="image/png,image/jpeg,image/webp"
          multiple
          className="hidden"
          onChange={onFilesSelected}
        />
        <PopoverContent side="top" sideOffset={8} className="w-48 p-1 text-sm">
          <AttachMenuItem
            icon={<Image />}
            label="Image..."
            onClick={() => inputRef.current?.click()}
          />
          <div className="px-2 pt-1 pb-0.5 text-[11px] font-medium uppercase text-muted-foreground">
            Portfolios
          </div>
          {portfolioOptions.map((portfolio) => (
            <AttachMenuItem
              key={portfolio.id}
              icon={<WalletCards />}
              label={portfolio.name}
              onClick={() => {
                onAddAttachment?.(portfolioAttachmentForOption(portfolio));
                setOpen(false);
              }}
            />
          ))}
          <div className="px-2 pt-1 pb-0.5 text-[11px] font-medium uppercase text-muted-foreground">
            Watchlists
          </div>
          {watchlistOptions.map((watchlist) => (
            <AttachMenuItem
              key={watchlist.id}
              icon={<PieChart />}
              label={watchlist.name}
              onClick={() => {
                onAddAttachment?.(watchlistAttachmentForOption(watchlist));
                setOpen(false);
              }}
            />
          ))}
          <AttachMenuItem
            icon={<Newspaper />}
            label="Latest report"
            onClick={() => {
              onAddAttachment?.({ kind: "report", id: "latest", label: "Latest report" });
              setOpen(false);
            }}
          />
        </PopoverContent>
      </PopoverAnchor>
    </Popover>
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
            className="ml-auto inline-flex size-10 items-center justify-center rounded-full text-muted-foreground transition-[background-color,color,transform,scale] duration-150 ease-out hover:bg-secondary hover:text-foreground active:scale-[0.96] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
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
      className="flex min-h-10 w-full items-center gap-2 rounded-md px-2 py-2 text-left transition-[background-color,transform,scale] duration-150 ease-out hover:bg-secondary active:scale-[0.96] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      onClick={onClick}
    >
      {icon ? <span className="[&>svg]:h-4 [&>svg]:w-4">{icon}</span> : null}
      <span>{label}</span>
    </button>
  );
}
