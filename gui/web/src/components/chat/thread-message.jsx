import { renderRichText, textContent } from "../../rendering/text.js";
import { Badge } from "../ui/badge.jsx";

const EMPTY_ATTACHMENTS = [];

export function UserMessage({ content, attachments = EMPTY_ATTACHMENTS }) {
  const images = (content || []).filter((part) => part.type === "image");
  return (
    <div className="flex justify-end">
      <div className="max-w-[min(640px,86%)] rounded-2xl bg-secondary px-4 py-2.5 text-sm leading-relaxed text-foreground">
        <div>{textContent(content)}</div>
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
      </div>
    </div>
  );
}

export function AssistantMessage({ content }) {
  return (
    <div className="max-w-[min(920px,100%)] text-base leading-[1.65rem] text-foreground">
      <div
        className="rich-text chat-markdown"
        dangerouslySetInnerHTML={{ __html: renderRichText(textContent(content)) }}
      />
    </div>
  );
}

export function CustomMessage({ customType, content }) {
  return (
    <div className="flex max-w-[760px] flex-wrap items-start gap-2 text-sm">
      <Badge variant="warning">{customType}</Badge>
      <span className="text-foreground">{textContent(content)}</span>
    </div>
  );
}
