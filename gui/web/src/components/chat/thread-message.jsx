import { Badge } from "../ui/badge.jsx";
import { renderRichText, textContent } from "../../rendering/text.js";

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
    <div className="max-w-[760px] text-sm leading-relaxed text-foreground">
      <div className="rich-text" dangerouslySetInnerHTML={{ __html: renderRichText(textContent(content)) }} />
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

export function ToolCallMessage({ toolCalls }) {
  return (
    <div className="flex max-w-[760px] flex-wrap items-start gap-2.5 text-sm text-muted-foreground">
      <Badge>Using {toolCalls.length === 1 ? "tool" : "tools"}</Badge>
      <div className="grid min-w-0 gap-1">
        {toolCalls.map((toolCall) => (
          <span className="flex flex-wrap items-center gap-2" key={toolCall.id}>
            <strong className="text-sm font-medium text-foreground">{prettyToolName(toolCall.name)}</strong>
            <code>{JSON.stringify(toolCall.arguments || {})}</code>
          </span>
        ))}
      </div>
    </div>
  );
}

function prettyToolName(name) {
  return String(name || "").replace(/^get_/, "").replace(/_/g, " ");
}
