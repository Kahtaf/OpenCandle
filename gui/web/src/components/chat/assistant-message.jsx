// biome-ignore-all lint/security/noDangerouslySetInnerHtml: renderRichText escapes user content before adding known safe markup.

import { renderRichText, textContent } from "../../rendering/text.js";

const EMPTY_KNOWN_SYMBOLS = [];

export function AssistantMessage({ content, knownSymbols = EMPTY_KNOWN_SYMBOLS }) {
  return (
    <div className="max-w-[min(920px,100%)] text-base leading-[1.65rem] text-foreground">
      <div
        className="rich-text chat-markdown"
        dangerouslySetInnerHTML={{ __html: renderRichText(textContent(content), { knownSymbols }) }}
      />
    </div>
  );
}
