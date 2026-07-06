import { textContent } from "../../rendering/text.js";
import { Badge } from "../ui/badge.jsx";

export function CustomMessage({ customType, content }) {
  return (
    <div className="flex max-w-[760px] flex-wrap items-start gap-2 text-sm">
      <Badge variant="warning">{customType}</Badge>
      <span className="text-foreground">{textContent(content)}</span>
    </div>
  );
}
