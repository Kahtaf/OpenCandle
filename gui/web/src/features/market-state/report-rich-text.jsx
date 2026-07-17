// biome-ignore-all lint/security/noDangerouslySetInnerHtml: renderRichText escapes report content before adding known safe markup.

import { renderRichText } from "../../rendering/text.js";

export function ReportRichText({ children }) {
  return (
    <div
      className="rich-text chat-markdown"
      dangerouslySetInnerHTML={{ __html: renderRichText(children) }}
    />
  );
}
