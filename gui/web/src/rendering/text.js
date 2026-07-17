export function textContent(content) {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) return content.map((part) => part.text || part.name || "").join("\n");
  return "";
}

export function renderRichText(markdown, options = {}) {
  const lines = promoteWorkflowSections(markdown).split(/\r?\n/);
  const html = [];
  let paragraph = [];
  let list = [];
  let table = [];

  const flushParagraph = () => {
    if (!paragraph.length) return;
    html.push(`<p>${renderInline(paragraph.join(" "), options)}</p>`);
    paragraph = [];
  };
  const flushList = () => {
    if (!list.length) return;
    html.push(`<ul>${list.map((item) => `<li>${renderInline(item, options)}</li>`).join("")}</ul>`);
    list = [];
  };
  const flushTable = () => {
    if (table.length < 2) {
      paragraph.push(...table);
      table = [];
      return;
    }
    const rows = table.filter(
      (line) => !/^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(line),
    );
    const cells = rows.map(splitTableRow);
    const [head, ...body] = cells;
    const numericColumns = head.map((_, columnIndex) => {
      const columnCells = body.map((row) => row[columnIndex] ?? "");
      const meaningful = columnCells.filter((cell) => !isNeutralTableCell(cell));
      return meaningful.length > 0 && meaningful.every(isNumericTableCell);
    });
    html.push(
      `<div class="rich-table"><table><thead><tr>${head.map((cell, index) => `<th scope="col"${numericColumns[index] ? ' class="rich-table__numeric"' : ""}>${renderInline(cell, options)}</th>`).join("")}</tr></thead><tbody>${body.map((row) => `<tr>${row.map((cell, index) => `<td${numericColumns[index] ? ' class="rich-table__numeric"' : ""}>${renderInline(cell, options)}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`,
    );
    table = [];
  };
  const flushAll = () => {
    flushTable();
    flushList();
    flushParagraph();
  };

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) {
      flushAll();
      continue;
    }
    if (line.includes("|") && /^\|?.+\|.+/.test(line)) {
      flushParagraph();
      flushList();
      table.push(line);
      continue;
    }
    flushTable();
    if (/^([-*_])(?:\s*\1){2,}$/.test(line)) {
      flushList();
      flushParagraph();
      html.push("<hr>");
      continue;
    }
    const heading = line.match(/^(#{1,6})\s+(.+)$/);
    if (heading) {
      flushList();
      flushParagraph();
      const level = Math.min(5, Math.max(3, heading[1].length));
      html.push(`<h${level}>${renderInline(heading[2], options)}</h${level}>`);
      continue;
    }
    const bullet = line.match(/^[-*]\s+(.+)$/);
    if (bullet) {
      flushParagraph();
      list.push(bullet[1]);
      continue;
    }
    flushList();
    paragraph.push(line);
  }
  flushAll();
  return html.join("");
}

function promoteWorkflowSections(markdown) {
  return String(markdown || "").replace(
    /\*\*(BULL THESIS|BEAR THESIS|VERDICT|CORRECTIONS(?: NEEDED)?)(?::\*\*|\*\*:)[ \t]*/gi,
    (_match, label) => `\n\n### ${String(label).toUpperCase()}\n\n`,
  );
}

function splitTableRow(line) {
  return line
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((cell) => cell.trim());
}

// Placeholder cells (N/A, dashes, empty) neither qualify nor disqualify a
// column as numeric — a mostly-numeric column with one "N/A" stays aligned.
function isNeutralTableCell(value) {
  return /^(?:n\/a|na|—|–|-|)$/i.test(String(value).trim());
}

function isNumericTableCell(value) {
  const normalized = String(value)
    .trim()
    .replace(/[,$%+]/g, "")
    .replaceAll("−", "-");
  return normalized.length > 0 && Number.isFinite(Number(normalized));
}

export function renderInline(value, options = {}) {
  return String(value ?? "")
    .split(/(`[^`]*`)/g)
    .map((segment) => {
      if (segment.startsWith("`") && segment.endsWith("`")) {
        return `<code>${escapeHtml(segment.slice(1, -1))}</code>`;
      }
      return linkifyEntities(
        escapeHtml(segment).replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>"),
        options,
      );
    })
    .join("");
}

export function escapeHtml(value) {
  return String(value ?? "").replace(
    /[&<>"']/g,
    (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" })[char],
  );
}

function linkifyEntities(html, options) {
  const known = new Set((options.knownSymbols ?? []).map((symbol) => String(symbol).toUpperCase()));
  const chips = [];
  const reserve = (markup) => {
    const token = `@@occhip${chips.length}@@`;
    chips.push(markup);
    return token;
  };
  const withCashtags = html.replace(/\$([A-Za-z]{1,6})\b/g, (_match, symbol) =>
    reserve(entityChip(symbol, `$${String(symbol).toUpperCase()}`)),
  );
  const withBareSymbols = withCashtags.replace(/\b[A-Z]{1,6}\b/g, (token) =>
    known.has(token) ? reserve(entityChip(token, token)) : token,
  );
  return withBareSymbols.replace(/@@occhip(\d+)@@/g, (_match, index) => chips[Number(index)] ?? "");
}

function entityChip(symbol, label) {
  const normalized = String(symbol).toUpperCase();
  return `<button type="button" class="entity-chip" data-symbol="${normalized}">${label}</button>`;
}
