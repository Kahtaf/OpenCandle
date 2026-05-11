import { GenericCard, rendererFor } from "./cards/index.jsx";
import { RawDetails, ToolHeader, WarningRow, extractDetails } from "./cards/_shared.jsx";
import { textContent } from "../../rendering/text.js";

export function ToolResultCard({ message }) {
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
      <ToolHeader category={category} title={prettyToolName(message.toolName)} manual={manual} isError={isError} />
      <WarningRow items={warnings} />
    </div>
  );

  return (
    <div className="grid gap-2">
      <Component message={message} header={header} text={text} />
      <RawDetails message={message} details={details} text={text} />
    </div>
  );
}

function extractWarnings(details, text) {
  const warnings = [];
  const source = `${JSON.stringify(details || {})}\n${text || ""}`.toLowerCase();
  if (source.includes("credential_required") || source.includes("api key")) warnings.push("Credential required");
  if (source.includes("stale")) warnings.push("Stale data");
  if (source.includes("partial") || source.includes("degraded")) warnings.push("Partial data");
  if (source.includes("delayed")) warnings.push("Delayed data");
  return [...new Set(warnings)];
}

function prettyToolName(name) {
  return String(name || "").replace(/^get_/, "").replace(/_/g, " ");
}
