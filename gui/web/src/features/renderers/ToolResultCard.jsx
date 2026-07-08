import { textContent } from "../../rendering/text.js";
import { RawDetails, ToolHeader, WarningRow } from "./cards/_shared.jsx";
import { extractDetails } from "./cards/card-format.js";
import { GenericCard, rendererFor } from "./cards/index.jsx";

export function ToolResultCard({ message, sessionMarketFacts }) {
  const text = textContent(message.content);
  const details = extractDetails(message);
  const manual = message.details?.source === "ui";
  const isError = Boolean(message.isError);
  const renderer = rendererFor(message.toolName);
  const Component = renderer?.Component ?? GenericCard;
  const category = renderer?.category ?? "Tool";
  const warnings = extractWarnings(details, text);

  const header = (
    <div className="grid gap-2">
      <ToolHeader
        category={category}
        title={prettyToolName(message.toolName)}
        manual={manual}
        isError={isError}
      />
      <WarningRow items={warnings} />
    </div>
  );

  return (
    <div className="grid gap-2">
      <Component
        message={message}
        header={header}
        text={text}
        sessionMarketFacts={sessionMarketFacts}
      />
      <RawDetails message={message} details={details} text={text} />
    </div>
  );
}

function extractWarnings(details, text) {
  const warnings = [];
  const source = `${JSON.stringify(details || {})}\n${text || ""}`.toLowerCase();
  if (source.includes("credential_required") || source.includes("api key"))
    warnings.push("Credential required");
  if (source.includes("stale")) warnings.push("Stale data");
  if (source.includes("partial") || source.includes("degraded")) warnings.push("Partial data");
  if (source.includes("delayed")) warnings.push("Delayed data");
  return [...new Set(warnings)];
}

function prettyToolName(name) {
  return String(name || "")
    .replace(/^get_/, "")
    .replace(/_/g, " ");
}
