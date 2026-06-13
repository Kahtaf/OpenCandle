import { renderRichText, textContent } from "../../rendering/text.js";
import { Badge } from "../ui/badge.jsx";

export function UserMessage({ content }) {
  return (
    <div className="flex justify-end">
      <div className="max-w-[min(640px,86%)] rounded-2xl bg-secondary px-4 py-2.5 text-sm leading-relaxed text-foreground">
        {textContent(content)}
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
