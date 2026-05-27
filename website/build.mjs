import { cp, mkdir, readFile, rm, writeFile, copyFile } from "node:fs/promises";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const outDir = join(root, "website/dist");
const siteUrl = "https://opencandle.app";
const brandName = "OpenCandle";
const landingTitle = "OpenCandle";
const landingDescription =
  "OpenCandle is an open source financial investigator that gathers quotes, filings, macro data, options, sentiment, and portfolio context in a local CLI or GUI.";
const socialImage = `${siteUrl}/assets/gui-screenshot.png`;

const sourcePages = [
  { source: "docs/index.md", output: "docs/index.html", section: "Docs" },
  { source: "docs/getting-started.md", output: "docs/getting-started.html", section: "Use" },
  { source: "docs/first-run.md", output: "docs/first-run.html", section: "Use" },
  { source: "docs/tui.md", output: "docs/tui.html", section: "Use" },
  { source: "docs/investigation-recipes.md", output: "docs/investigation-recipes.html", section: "Use" },
  { source: "docs/data-sources.md", output: "docs/data-sources.html", section: "Use" },
  { source: "docs/configuration.md", output: "docs/configuration.html", section: "Use" },
  { source: "docs/gui-quickstart.md", output: "docs/gui-quickstart.html", section: "Use" },
  { source: "docs/system-architecture.md", output: "docs/system-architecture.html", section: "Build" },
  { source: "docs/build-a-tool.md", output: "docs/build-a-tool.html", section: "Build" },
  { source: "docs/testing-and-evals.md", output: "docs/testing-and-evals.html", section: "Build" },
  { source: "docs/benchmarking.md", output: "docs/benchmarking.html", section: "Build" },
  { source: "docs/comparisons.md", output: "docs/comparisons.html", section: "Compare" },
  { source: "docs/opencandle-vs-chatgpt.md", output: "docs/opencandle-vs-chatgpt.html", section: "Compare" },
  { source: "docs/opencandle-vs-spreadsheets.md", output: "docs/opencandle-vs-spreadsheets.html", section: "Compare" },
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

const markdownOutput = (output) => output.replace(/\.html$/, ".md");

const absoluteUrl = (path) => `${siteUrl}/${path.replace(/^index\.html$/, "").replace(/^\//, "")}`;

function jsonLd(data) {
  return `<script type="application/ld+json">${JSON.stringify(data).replaceAll("<", "\\u003c")}</script>`;
}

function sharedHeadTags({ title, description, canonicalUrl, image = socialImage, markdownUrl }) {
  return `
    <link rel="canonical" href="${escapeHtml(canonicalUrl)}">
    <meta property="og:site_name" content="${brandName}">
    <meta property="og:type" content="website">
    <meta property="og:title" content="${escapeHtml(title)}">
    <meta property="og:description" content="${escapeHtml(description)}">
    <meta property="og:url" content="${escapeHtml(canonicalUrl)}">
    <meta property="og:image" content="${escapeHtml(image)}">
    <meta name="twitter:card" content="summary_large_image">
    <meta name="twitter:title" content="${escapeHtml(title)}">
    <meta name="twitter:description" content="${escapeHtml(description)}">
    <meta name="twitter:image" content="${escapeHtml(image)}">
    <link rel="alternate" type="text/plain" href="${siteUrl}/llms.txt" title="OpenCandle AI guide">
    <link rel="alternate" type="text/markdown" href="${escapeHtml(markdownUrl)}" title="Markdown version">`;
}

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

function pageShell({ title, description, content, headings, output, buildDate }) {
  const rootPrefix = output.startsWith("docs/") ? "../" : "";
  const docsPrefix = output.startsWith("docs/") ? "" : "docs/";
  const canonicalUrl = absoluteUrl(output);
  const markdownUrl = absoluteUrl(markdownOutput(output));
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
    <meta name="author" content="Kahtaf">
    <meta name="date" content="${escapeHtml(buildDate)}">
    <title>${escapeHtml(title)} - OpenCandle</title>
    ${sharedHeadTags({
      title: `${title} - ${brandName}`,
      description,
      canonicalUrl,
      markdownUrl,
    })}
    <link rel="icon" href="${rootPrefix}assets/logo.svg" type="image/svg+xml">
    <link rel="alternate icon" href="${rootPrefix}favicon.ico">
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
    <link href="https://fonts.googleapis.com/css2?family=DM+Sans:opsz,wght@9..40,400;9..40,500;9..40,600;9..40,700&display=swap" rel="stylesheet">
    <link rel="stylesheet" href="${rootPrefix}styles.css">
    ${jsonLd({
      "@context": "https://schema.org",
      "@type": "TechArticle",
      headline: `${title} - ${brandName}`,
      description,
      datePublished: buildDate,
      dateModified: buildDate,
      author: {
        "@type": "Person",
        name: "Kahtaf",
        jobTitle: "OpenCandle maintainer",
        description: "Maintainer of OpenCandle, an open source TypeScript financial research agent.",
        knowsAbout: ["TypeScript", "financial data tools", "agent workflows", "market research software"],
        url: "https://github.com/Kahtaf",
      },
      publisher: {
        "@type": "Organization",
        name: brandName,
        url: siteUrl,
        sameAs: ["https://github.com/Kahtaf/OpenCandle", "https://www.npmjs.com/package/opencandle"],
      },
      mainEntityOfPage: canonicalUrl,
    })}
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
          <p class="page-meta">Last updated <time datetime="${escapeHtml(buildDate)}">${escapeHtml(buildDate)}</time> by <a rel="author" href="https://github.com/Kahtaf">Kahtaf</a>.</p>
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

function landingShell(buildDate) {
  const faqs = [
    {
      question: "What is OpenCandle?",
      answer:
        "OpenCandle is an open source financial investigator that runs as a terminal agent and local browser GUI for evidence-first market research.",
    },
    {
      question: "Does OpenCandle place trades?",
      answer:
        "No. OpenCandle is read-only research software. It gathers and organizes market evidence, but it does not place trades, route orders, or provide financial advice.",
    },
    {
      question: "Which data sources does OpenCandle use?",
      answer:
        "OpenCandle integrates Yahoo Finance, Alpha Vantage, FRED, CoinGecko, Reddit, SEC EDGAR, DuckDuckGo, Brave, Exa, Finnhub, and local portfolio state where configured.",
    },
    {
      question: "Can I run OpenCandle without installing it globally?",
      answer:
        "Yes. Run npx opencandle@latest for the terminal agent or npx opencandle@latest gui for the local browser GUI.",
    },
    {
      question: "How is OpenCandle different from a general chatbot?",
      answer:
        "OpenCandle calls explicit finance tools first, shows provider gaps and stale data, and asks the model to synthesize only after evidence has been gathered.",
    },
  ];
  const faqHtml = faqs
    .map(
      (faq) => `<article>
          <h3>${escapeHtml(faq.question)}</h3>
          <div>${escapeHtml(faq.answer)}</div>
        </article>`,
    )
    .join("");
  const canonicalUrl = siteUrl;

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <meta name="description" content="${escapeHtml(landingDescription)}">
    <meta name="author" content="Kahtaf">
    <meta name="date" content="${escapeHtml(buildDate)}">
    <title>${landingTitle}</title>
    ${sharedHeadTags({
      title: landingTitle,
      description: landingDescription,
      canonicalUrl,
      markdownUrl: `${siteUrl}/llms-full.txt`,
    })}
    <link rel="icon" href="assets/logo.svg" type="image/svg+xml">
    <link rel="alternate icon" href="favicon.ico">
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
    <link href="https://fonts.googleapis.com/css2?family=DM+Sans:opsz,wght@9..40,400;9..40,500;9..40,600;9..40,700&display=swap" rel="stylesheet">
    <link rel="stylesheet" href="styles.css">
    ${jsonLd({
      "@context": "https://schema.org",
      "@graph": [
        {
          "@type": "Organization",
          "@id": `${siteUrl}/#organization`,
          name: brandName,
          url: siteUrl,
          logo: `${siteUrl}/assets/logo.svg`,
          sameAs: ["https://github.com/Kahtaf/OpenCandle", "https://www.npmjs.com/package/opencandle"],
        },
        {
          "@type": "Person",
          "@id": `${siteUrl}/#maintainer`,
          name: "Kahtaf",
          jobTitle: "OpenCandle maintainer",
          description: "Maintainer of OpenCandle, an open source TypeScript financial research agent.",
          knowsAbout: ["TypeScript", "financial data tools", "agent workflows", "market research software"],
          url: "https://github.com/Kahtaf",
          sameAs: ["https://github.com/Kahtaf"],
        },
        {
          "@type": "WebSite",
          name: brandName,
          url: siteUrl,
          publisher: { "@id": `${siteUrl}/#organization` },
          dateModified: buildDate,
        },
        {
          "@type": "SoftwareApplication",
          name: brandName,
          applicationCategory: "FinanceApplication",
          operatingSystem: "macOS, Windows, Linux",
          url: siteUrl,
          codeRepository: "https://github.com/Kahtaf/OpenCandle",
          downloadUrl: "https://www.npmjs.com/package/opencandle",
          license: "https://github.com/Kahtaf/OpenCandle/blob/main/LICENSE",
          description: landingDescription,
          author: { "@id": `${siteUrl}/#maintainer` },
          publisher: { "@id": `${siteUrl}/#organization` },
        },
        {
          "@type": "HowTo",
          name: "Run OpenCandle",
          description: "Install-free quick start for the OpenCandle terminal agent or local browser GUI.",
          step: [
            { "@type": "HowToStep", name: "Start the terminal agent", text: "Run npx opencandle@latest." },
            { "@type": "HowToStep", name: "Start the GUI", text: "Run npx opencandle@latest gui." },
            { "@type": "HowToStep", name: "Ask a market question", text: "Ask for a quote, filing, macro series, options chain, sentiment read, or portfolio review." },
          ],
        },
        {
          "@type": "FAQPage",
          mainEntity: faqs.map((faq) => ({
            "@type": "Question",
            name: faq.question,
            acceptedAnswer: {
              "@type": "Answer",
              text: faq.answer,
            },
          })),
        },
      ],
    })}
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
          <p class="hero-lede">Orchestrate quotes, filings, macro data, sentiment, options, and portfolio tools from one local surface. Works with OpenAI, Anthropic, and Google model keys.</p>
          <p class="hero-note">Read-only research software. Not investment advice. No order routing.</p>
          <div class="hero-actions">
            <a class="button-primary" href="docs/getting-started.html">Install OpenCandle</a>
            <a class="button-secondary" href="https://github.com/Kahtaf/OpenCandle">Star on GitHub</a>
          </div>
        </div>
        <div id="product" class="hero-product live-gui-callout">
          <div class="window-dots" aria-hidden="true"><span></span><span></span><span></span></div>
          <img src="assets/gui-screenshot.png" alt="OpenCandle GUI showing a completed research answer with evidence sources and risk commentary" width="1440" height="1000" fetchpriority="high">
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
          <p>OpenCandle does not hide setup behind magic. Pi handles local model setup and sessions; OpenCandle adds finance tools on top. Add optional market data keys where needed and keep keyless sources working by default.</p>
        </div>
        <div class="provider-grid">
          <div><strong>OpenAI</strong><code>model access</code></div>
          <div><strong>Anthropic</strong><code>model access</code></div>
          <div><strong>Google</strong><code>model access</code></div>
          <div><strong>Yahoo Finance</strong><code>quotes, options</code></div>
          <div><strong>SEC EDGAR</strong><code>filings</code></div>
          <div><strong>FRED</strong><code>macro series</code></div>
          <div><strong>Reddit + Web</strong><code>sentiment, search</code></div>
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
          <div><span>Evidence</span><strong>provider quote timestamp, SEC filing links, source-counted sentiment, dated macro observation</strong></div>
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
            <code>$ npx opencandle@latest</code>
            <code>$ opencandle gui</code>
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

      <section id="faq" class="landing-band faq-section">
        <div class="section-kicker">FAQ</div>
        <h2>Direct answers for AI and humans.</h2>
        <div class="faq-grid">
          ${faqHtml}
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

function renderLlmsTxt(loaded, buildDate) {
  return `# OpenCandle

> OpenCandle is an open source financial investigator for evidence-first market research in a terminal agent or local browser GUI.

Last updated: ${buildDate}
Website: ${siteUrl}
Repository: https://github.com/Kahtaf/OpenCandle
Package: https://www.npmjs.com/package/opencandle

## Quick start

\`\`\`bash
npx opencandle@latest
npx opencandle@latest gui
\`\`\`

## Summary

OpenCandle gathers quotes, price history, options chains, SEC filings, macro series, sentiment, fundamentals, crypto data, and local portfolio context before synthesis. It is read-only research software: it does not place trades, route orders, or provide financial advice.

## Key pages

${loaded.map((page) => `- [${page.title}](${siteUrl}/${page.output}): ${page.description}`).join("\n")}

## AI-readable files

- [Full markdown context](${siteUrl}/llms-full.txt)
- [Project agent instructions](${siteUrl}/AGENTS.md)
`;
}

async function renderLlmsFullTxt(loaded, buildDate) {
  const sections = [];
  for (const page of loaded) {
    const markdown = await readFile(join(root, page.source), "utf8");
    const { body } = stripFrontmatter(markdown);
    sections.push(`## ${page.title}

Source: ${siteUrl}/${page.output}

${body.trim()}`);
  }

  return `# OpenCandle full AI context

Last updated: ${buildDate}
Canonical site: ${siteUrl}
Repository: https://github.com/Kahtaf/OpenCandle
Package: https://www.npmjs.com/package/opencandle

OpenCandle is an open source financial investigator. It runs as a terminal agent and local browser GUI, gathers finance data through explicit tools, records provider gaps, and then synthesizes answers from gathered evidence.

${sections.join("\n\n---\n\n")}
`;
}

async function build() {
  const buildDate = new Date().toISOString().slice(0, 10);

  await rm(outDir, { recursive: true, force: true });
  await mkdir(join(outDir, "assets"), { recursive: true });
  await copyFile(join(root, "assets/logo.svg"), join(outDir, "assets/logo.svg"));
  await cp(join(root, "website/assets"), join(outDir, "assets"), { recursive: true });
  await copyFile(join(root, "website/assets/favicon.ico"), join(outDir, "favicon.ico"));
  await copyFile(join(root, "website/styles.css"), join(outDir, "styles.css"));
  await copyFile(join(root, "AGENTS.md"), join(outDir, "AGENTS.md"));

  const loaded = [];
  for (const page of sourcePages) {
    const markdown = await readFile(join(root, page.source), "utf8");
    const { attrs, body } = stripFrontmatter(markdown);
    const title = attrs.title ?? body.match(/^#\s+(.+)$/m)?.[1] ?? page.source;
    loaded.push({ ...page, title, description: attrs.description ?? "OpenCandle documentation." });
  }

  sitePages = loaded;

  await writeFile(join(outDir, "index.html"), landingShell(buildDate));
  await writeFile(join(outDir, "llms.txt"), renderLlmsTxt(loaded, buildDate));
  await writeFile(join(outDir, "llms-full.txt"), await renderLlmsFullTxt(loaded, buildDate));
  await writeFile(
    join(outDir, "robots.txt"),
    `User-agent: *\nAllow: /\n\nSitemap: ${siteUrl}/sitemap.xml\n`,
  );
  await writeFile(
    join(outDir, "sitemap.xml"),
    `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n  <url><loc>${siteUrl}/</loc><lastmod>${buildDate}</lastmod></url>\n${loaded
      .flatMap((page) => [page.output, markdownOutput(page.output)])
      .map((output) => `  <url><loc>${siteUrl}/${output}</loc><lastmod>${buildDate}</lastmod></url>`)
      .join("\n")}\n</urlset>\n`,
  );

  for (const page of loaded) {
    const markdown = await readFile(join(root, page.source), "utf8");
    const { body } = stripFrontmatter(markdown);
    const { html, headings } = renderMarkdown(body, page.output);
    const filePath = join(outDir, page.output);
    await mkdir(dirname(filePath), { recursive: true });
    await writeFile(join(outDir, markdownOutput(page.output)), body);
    await writeFile(
      filePath,
      pageShell({
        title: page.title,
        description: page.description,
        content: html,
        headings,
        output: page.output,
        buildDate,
      }),
    );
  }

  const relativeOut = relative(root, outDir);
  console.log(`Built landing page and ${loaded.length} docs pages in ${relativeOut}`);
}

await build();
