import { cp, mkdir, readFile, rm, writeFile, copyFile } from "node:fs/promises";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const outDir = join(root, "website/dist");

const sourcePages = [
  { source: "docs/index.md", output: "docs/index.html", section: "Docs" },
  { source: "docs/getting-started.md", output: "docs/getting-started.html", section: "Use" },
  { source: "docs/investigation-recipes.md", output: "docs/investigation-recipes.html", section: "Use" },
  { source: "docs/data-sources.md", output: "docs/data-sources.html", section: "Use" },
  { source: "docs/gui-quickstart.md", output: "docs/gui-quickstart.html", section: "Use" },
  { source: "docs/system-architecture.md", output: "docs/system-architecture.html", section: "Build" },
  { source: "docs/build-a-tool.md", output: "docs/build-a-tool.html", section: "Build" },
  { source: "docs/testing-and-evals.md", output: "docs/testing-and-evals.html", section: "Build" },
  { source: "CONTRIBUTING.md", output: "docs/contributing.html", section: "Project" },
  { source: "SECURITY.md", output: "docs/security.html", section: "Project" },
];

let sitePages = sourcePages;
const sourceToOutput = new Map(sourcePages.map((page) => [page.source, page.output]));
const basenameToOutput = new Map(sourcePages.map((page) => [page.source.split("/").at(-1), page.output]));

const escapeHtml = (value) =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");

function stripFrontmatter(markdown) {
  if (!markdown.startsWith("---\n")) return { attrs: {}, body: markdown };
  const end = markdown.indexOf("\n---\n", 4);
  if (end === -1) return { attrs: {}, body: markdown };
  const raw = markdown.slice(4, end).trim();
  const attrs = {};
  for (const line of raw.split("\n")) {
    const index = line.indexOf(":");
    if (index === -1) continue;
    const key = line.slice(0, index).trim();
    const value = line.slice(index + 1).trim().replace(/^"|"$/g, "");
    attrs[key] = value;
  }
  return { attrs, body: markdown.slice(end + 5).trimStart() };
}

function slugify(value) {
  return value
    .toLowerCase()
    .replace(/`([^`]+)`/g, "$1")
    .replace(/<[^>]+>/g, "")
    .replace(/[^a-z0-9\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-");
}

function relativeHref(targetOutput, fromOutput) {
  if (!fromOutput) return targetOutput;
  const fromDir = dirname(fromOutput);
  const target = relative(fromDir, targetOutput);
  return target === "" ? "." : target;
}

function rewriteLocalHref(href, fromOutput) {
  if (href.startsWith("http") || href.startsWith("#") || href.startsWith("mailto:")) {
    return href;
  }
  const [rawPath, hash = ""] = href.split("#");
  const cleanPath = rawPath.replace(/^\.\//, "");
  const output = sourceToOutput.get(cleanPath) ?? basenameToOutput.get(cleanPath);
  if (output) return `${relativeHref(output, fromOutput)}${hash ? `#${hash}` : ""}`;
  if (cleanPath.endsWith(".md")) {
    return `https://github.com/Kahtaf/OpenCandle/blob/main/${cleanPath}${hash ? `#${hash}` : ""}`;
  }
  return href;
}

function inlineMarkdown(value, fromOutput) {
  let html = escapeHtml(value);
  html = html.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (_match, alt, src) => {
    return `<img src="${escapeHtml(src)}" alt="${escapeHtml(alt)}">`;
  });
  html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_match, label, href) => {
    return `<a href="${escapeHtml(rewriteLocalHref(href, fromOutput))}">${label}</a>`;
  });
  html = html.replace(/`([^`]+)`/g, "<code>$1</code>");
  html = html.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  return html;
}

function renderTable(lines, fromOutput) {
  const rows = lines
    .map((line) => line.trim().replace(/^\||\|$/g, "").split("|").map((cell) => cell.trim()))
    .filter((row) => row.length > 1);
  if (rows.length < 2) return "";
  const [head, _divider, ...body] = rows;
  return `<table><thead><tr>${head
    .map((cell) => `<th>${inlineMarkdown(cell, fromOutput)}</th>`)
    .join("")}</tr></thead><tbody>${body
    .map((row) => `<tr>${row.map((cell) => `<td>${inlineMarkdown(cell, fromOutput)}</td>`).join("")}</tr>`)
    .join("")}</tbody></table>`;
}

function renderMarkdown(markdown, fromOutput) {
  const lines = markdown.split(/\r?\n/);
  const html = [];
  const headings = [];
  let paragraph = [];
  let list = null;
  let code = null;
  let table = [];

  const flushParagraph = () => {
    if (paragraph.length === 0) return;
    html.push(`<p>${inlineMarkdown(paragraph.join(" "), fromOutput)}</p>`);
    paragraph = [];
  };

  const flushList = () => {
    if (!list) return;
    html.push(
      `<${list.type}>${list.items.map((item) => `<li>${inlineMarkdown(item, fromOutput)}</li>`).join("")}</${list.type}>`,
    );
    list = null;
  };

  const flushTable = () => {
    if (table.length === 0) return;
    html.push(renderTable(table, fromOutput));
    table = [];
  };

  for (const line of lines) {
    if (code) {
      if (line.startsWith("```")) {
        html.push(`<pre><code class="language-${escapeHtml(code.lang)}">${escapeHtml(code.lines.join("\n"))}</code></pre>`);
        code = null;
      } else {
        code.lines.push(line);
      }
      continue;
    }

    const fence = line.match(/^```(\w+)?/);
    if (fence) {
      flushParagraph();
      flushList();
      flushTable();
      code = { lang: fence[1] ?? "text", lines: [] };
      continue;
    }

    if (line.trim() === "") {
      flushParagraph();
      flushList();
      flushTable();
      continue;
    }

    if (/^\|.+\|$/.test(line.trim())) {
      flushParagraph();
      flushList();
      table.push(line);
      continue;
    }

    flushTable();

    const heading = line.match(/^(#{1,3})\s+(.+)$/);
    if (heading) {
      flushParagraph();
      flushList();
      const level = heading[1].length;
      const text = heading[2].trim();
      const id = slugify(text);
      headings.push({ level, text: text.replace(/`/g, ""), id });
      html.push(`<h${level} id="${id}">${inlineMarkdown(text, fromOutput)}</h${level}>`);
      continue;
    }

    const bullet = line.match(/^- (.+)$/);
    if (bullet) {
      flushParagraph();
      if (!list || list.type !== "ul") list = { type: "ul", items: [] };
      list.items.push(bullet[1]);
      continue;
    }

    const ordered = line.match(/^\d+\. (.+)$/);
    if (ordered) {
      flushParagraph();
      if (!list || list.type !== "ol") list = { type: "ol", items: [] };
      list.items.push(ordered[1]);
      continue;
    }

    if (line.startsWith("> ")) {
      flushParagraph();
      flushList();
      html.push(`<blockquote>${inlineMarkdown(line.slice(2), fromOutput)}</blockquote>`);
      continue;
    }

    paragraph.push(line.trim());
  }

  flushParagraph();
  flushList();
  flushTable();

  return { html: html.join("\n"), headings };
}

function navHtml(activeOutput) {
  const groups = new Map();
  for (const page of sitePages) {
    if (!groups.has(page.section)) groups.set(page.section, []);
    groups.get(page.section).push(page);
  }

  return [...groups.entries()]
    .map(([section, items]) => {
      const links = items
        .map((page) => {
          const active = page.output === activeOutput ? ' aria-current="page"' : "";
          return `<a href="${relativeHref(page.output, activeOutput)}"${active}>${page.title}</a>`;
        })
        .join("");
      return `<div class="nav-group"><p>${section}</p>${links}</div>`;
    })
    .join("");
}

function pageShell({ title, description, content, headings, output }) {
  const rootPrefix = output.startsWith("docs/") ? "../" : "";
  const docsPrefix = output.startsWith("docs/") ? "" : "docs/";
  const toc = headings
    .filter((heading) => heading.level === 2)
    .map((heading) => `<a href="#${heading.id}">${escapeHtml(heading.text)}</a>`)
    .join("");

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <meta name="description" content="${escapeHtml(description)}">
    <title>${escapeHtml(title)} - OpenCandle</title>
    <link rel="icon" href="${rootPrefix}assets/logo.svg" type="image/svg+xml">
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
    <link href="https://fonts.googleapis.com/css2?family=DM+Sans:opsz,wght@9..40,400;9..40,500;9..40,600;9..40,700&display=swap" rel="stylesheet">
    <link rel="stylesheet" href="${rootPrefix}styles.css">
  </head>
  <body class="docs-page">
    <a class="skip-link" href="#main">Skip to content</a>
    <header class="landing-nav site-nav">
      <a class="brand" href="${rootPrefix}index.html" aria-label="OpenCandle home">
        <img src="${rootPrefix}assets/logo.svg" alt="" width="26" height="26">
        <span>OpenCandle</span>
      </a>
      <nav aria-label="Top navigation">
        <a class="nav-ghost" href="${rootPrefix}index.html">Home</a>
        <a class="nav-ghost" href="${docsPrefix}index.html">Docs</a>
        <a class="nav-ghost" href="https://github.com/Kahtaf/OpenCandle">GitHub</a>
        <a class="nav-solid" href="${docsPrefix}getting-started.html">Install</a>
      </nav>
    </header>
    <main id="main" class="docs-shell">
      <div class="docs-layout">
        <aside class="sidebar docs-panel" aria-label="Documentation">
          ${navHtml(output)}
        </aside>
        <article class="content docs-panel">
          ${content}
        </article>
        <aside class="toc docs-panel" aria-label="On this page">
          <p>On This Page</p>
          ${toc || "<span>No sections</span>"}
        </aside>
      </div>
    </main>
  </body>
</html>`;
}

function landingShell() {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <meta name="description" content="OpenCandle is an open source financial investigator for evidence-first market research.">
    <title>OpenCandle - Open source financial investigator</title>
    <link rel="icon" href="assets/logo.svg" type="image/svg+xml">
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
    <link href="https://fonts.googleapis.com/css2?family=DM+Sans:opsz,wght@9..40,400;9..40,500;9..40,600;9..40,700&display=swap" rel="stylesheet">
    <link rel="stylesheet" href="styles.css">
  </head>
  <body class="landing-page">
    <header class="landing-nav">
      <a class="brand" href="index.html" aria-label="OpenCandle home">
        <img src="assets/logo.svg" alt="" width="26" height="26">
        <span>OpenCandle</span>
      </a>
      <nav aria-label="Primary navigation">
        <a class="nav-ghost" href="index.html">Home</a>
        <a class="nav-ghost" href="docs/index.html">Docs</a>
        <a class="nav-ghost" href="https://github.com/Kahtaf/OpenCandle">GitHub</a>
        <a class="nav-solid" href="docs/getting-started.html">Install</a>
      </nav>
    </header>

    <main>
      <section class="landing-hero">
        <div class="hero-grid" aria-hidden="true"></div>
        <div class="float-tile tile-yahoo" aria-hidden="true">YF</div>
        <div class="float-tile tile-sec" aria-hidden="true">SEC</div>
        <div class="float-tile tile-fred" aria-hidden="true">FRED</div>
        <div class="float-tile tile-logo" aria-hidden="true"><img src="assets/logo.svg" alt="" width="52" height="52"></div>
        <div class="hero-copy">
          <h1>The open-source control plane for market research.</h1>
          <p class="hero-lede">Orchestrate quotes, filings, macro data, sentiment, options, and portfolio tools from one local surface. Bring your own model keys. Fork the whole thing.</p>
          <div class="hero-actions">
            <a class="button-primary" href="docs/getting-started.html">Install OpenCandle</a>
            <a class="button-secondary" href="https://github.com/Kahtaf/OpenCandle">Star on GitHub</a>
          </div>
        </div>
        <div id="product" class="hero-product live-gui-callout">
          <div class="window-dots" aria-hidden="true"><span></span><span></span><span></span></div>
          <img src="assets/gui-screenshot.png" alt="OpenCandle GUI showing the local research workspace" width="1440" height="1100" fetchpriority="high">
        </div>
      </section>

      <section class="landing-band social-proof">
        <h2>Built for research that needs receipts.</h2>
        <p>Real workflows for people who want evidence before synthesis.</p>
        <div class="proof-marquee">
          <article><span>Quote snapshots that keep provider and freshness visible.</span></article>
          <article><span>Filings, macro, options, and sentiment in the same thread.</span></article>
          <article><span>Local sessions, local portfolio state, inspectable tool output.</span></article>
          <article><span>Fixture-backed tests so provider parsing does not drift quietly.</span></article>
          <article><span>Tool output is visible before the model writes.</span></article>
          <article><span>Degraded providers are marked instead of hidden.</span></article>
        </div>
      </section>

      <section id="providers" class="landing-band provider-section">
        <div>
          <h2>Bring your own data stack</h2>
          <p>OpenCandle does not hide setup behind magic. Add model keys through Pi, add optional market data keys where needed, and keep keyless sources working by default.</p>
        </div>
        <div class="provider-grid">
          <div><strong>Yahoo Finance</strong><code>quotes, options</code></div>
          <div><strong>SEC EDGAR</strong><code>filings</code></div>
          <div><strong>FRED</strong><code>macro series</code></div>
          <div><strong>Reddit + Web</strong><code>sentiment</code></div>
        </div>
        <div class="provider-checks">
          <span>No data resale.</span>
          <span>Switch providers mid-thread.</span>
          <span>Keys stay in your local setup.</span>
        </div>
      </section>

      <section id="workflow" class="evidence-band">
        <div class="terminal-panel" aria-label="OpenCandle investigation workflow">
          <div class="terminal-title"><strong>Run an evidence sweep</strong><span>READY</span></div>
          <div><span>Prompt</span><strong>/analyze NVDA with quote, filings, sentiment, and macro context</strong></div>
          <div><span>Tools</span><strong>get_stock_quote -> get_sec_filings -> get_sentiment_summary -> get_economic_data</strong></div>
          <div><span>Evidence</span><strong>fresh quote, SEC records, partial sentiment, dated macro observation</strong></div>
          <div class="workflow-action"><a href="docs/investigation-recipes.html">Inspect tool output</a></div>
        </div>
        <div>
          <h2>One prompt to gather, cite, and caveat.</h2>
          <p>OpenCandle routes requests into workflows, calls explicit tools, records degradation, and only then lets the model synthesize.</p>
          <ul>
            <li>Auto-routes tickers, macro series, filings, and sentiment.</li>
            <li>Shows the evidence trail before the final answer.</li>
            <li>Flags partial data instead of smoothing over gaps.</li>
            <li>Works from the CLI or the local browser GUI.</li>
          </ul>
        </div>
      </section>

      <section id="open-source" class="landing-band open-source-section">
        <div class="section-kicker">Open source</div>
        <h2>If you do not like something, fork it.</h2>
        <p>OpenCandle is TypeScript, MIT licensed, and designed around explicit tool contracts. Add providers, publish tool packages, or change the GUI because the evidence path is yours to inspect.</p>
        <div class="oss-layout">
          <div class="code-window">
            <div class="code-title">~/opencandle</div>
            <code>$ git clone github.com/Kahtaf/OpenCandle</code>
            <code>$ npm install</code>
            <code>$ npm run gui</code>
            <code class="success">OpenCandle GUI listening on http://127.0.0.1:14567</code>
          </div>
          <div class="oss-grid">
            <div><strong>MIT</strong><span>Commercial-friendly license</span></div>
            <div><strong>TypeScript</strong><span>Strict types and fixture-backed tests</span></div>
            <div><strong>Local state</strong><span>Sessions and portfolio data stay inspectable</span></div>
            <div><strong>Tool packages</strong><span>Extend through Pi-compatible add-ons</span></div>
          </div>
        </div>
        <div class="oss-actions">
          <a href="https://github.com/Kahtaf/OpenCandle">Star on GitHub</a>
          <a href="https://github.com/Kahtaf/OpenCandle/fork">Fork the repo</a>
          <a href="docs/contributing.html">Read CONTRIBUTING.md</a>
        </div>
      </section>

      <section class="cta-band">
        <h2>Your market research deserves better than a tab pile.</h2>
        <p>OpenCandle is free, open source, and local-first. Install it, launch the GUI, and let your agent gather evidence before it writes.</p>
        <div class="hero-actions">
          <a class="button-primary" href="docs/getting-started.html">Install OpenCandle</a>
          <a class="button-secondary" href="docs/">Read the docs</a>
        </div>
      </section>
    </main>
    <footer class="landing-footer">
      <span>OpenCandle</span>
      <nav>
        <a href="https://github.com/Kahtaf/OpenCandle">GitHub</a>
        <a href="docs/">Docs</a>
        <a href="docs/getting-started.html">Install</a>
      </nav>
    </footer>
  </body>
</html>`;
}

async function build() {
  await rm(outDir, { recursive: true, force: true });
  await mkdir(join(outDir, "assets"), { recursive: true });
  await copyFile(join(root, "assets/logo.svg"), join(outDir, "assets/logo.svg"));
  await cp(join(root, "website/assets"), join(outDir, "assets"), { recursive: true });
  await copyFile(join(root, "website/styles.css"), join(outDir, "styles.css"));

  const loaded = [];
  for (const page of sourcePages) {
    const markdown = await readFile(join(root, page.source), "utf8");
    const { attrs, body } = stripFrontmatter(markdown);
    const title = attrs.title ?? body.match(/^#\s+(.+)$/m)?.[1] ?? page.source;
    loaded.push({ ...page, title, description: attrs.description ?? "OpenCandle documentation." });
  }

  sitePages = loaded;

  await writeFile(join(outDir, "index.html"), landingShell());

  for (const page of loaded) {
    const markdown = await readFile(join(root, page.source), "utf8");
    const { body } = stripFrontmatter(markdown);
    const { html, headings } = renderMarkdown(body, page.output);
    const filePath = join(outDir, page.output);
    await mkdir(dirname(filePath), { recursive: true });
    await writeFile(
      filePath,
      pageShell({
        title: page.title,
        description: page.description,
        content: html,
        headings,
        output: page.output,
      }),
    );
  }

  const relativeOut = relative(root, outDir);
  console.log(`Built landing page and ${loaded.length} docs pages in ${relativeOut}`);
}

await build();
