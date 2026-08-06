// biome-ignore-all lint/security/noDangerouslySetInnerHtml: renderInline escapes user text before adding known safe entity-chip markup.

import { renderInline, textContent } from "../../rendering/text.js";

const EMPTY_ATTACHMENTS = [];
const EMPTY_KNOWN_SYMBOLS = [];

export function UserMessage({
  content,
  attachments = EMPTY_ATTACHMENTS,
  knownSymbols = EMPTY_KNOWN_SYMBOLS,
  delivery = "sent",
}) {
  const images = (content || []).filter((part) => part.type === "image");
  return (
    <div className="flex justify-end">
      <div className="max-w-[min(640px,86%)] rounded-2xl bg-secondary px-4 py-2.5 text-sm leading-relaxed text-foreground">
        <div
          dangerouslySetInnerHTML={{
            __html: renderInline(textContent(content), { knownSymbols }),
          }}
        />
        {attachments.length > 0 ? (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {attachments.map((attachment) => (
              <span
                key={`${attachment.kind}-${attachment.label}`}
                className="rounded-full border border-border bg-background px-2 py-0.5 text-[11px] font-medium text-muted-foreground"
              >
                {attachment.label}
              </span>
            ))}
          </div>
        ) : null}
        {images.length > 0 ? (
          <div className="mt-2 flex flex-wrap gap-2">
            {images.map((image) => (
              <img
                key={image.url || image.data || "image"}
                src={image.url || `data:${image.mimeType};base64,${image.data}`}
                alt={image.alt || "Attached image"}
                className="h-20 w-20 rounded-lg border border-border object-cover"
              />
            ))}
          </div>
        ) : null}
        {delivery === "queued" ? (
          <div className="mt-2 text-right text-[11px] font-medium text-muted-foreground">
            Queued
          </div>
        ) : null}
      </div>
    </div>
  );
}
