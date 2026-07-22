import { copyFile, cp, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, normalize, posix, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Badge, Button, Card, OpenCandleLogo } from "@opencandle/ui";
import matter from "gray-matter";
import { toString as mdastToString } from "mdast-util-to-string";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import rehypeAutolinkHeadings from "rehype-autolink-headings";
import rehypeSlug from "rehype-slug";
import rehypeStringify from "rehype-stringify";
import remarkGfm from "remark-gfm";
import remarkParse from "remark-parse";
import remarkRehype from "remark-rehype";
import { unified } from "unified";
import { visit } from "unist-util-visit";

globalThis.React = React;

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const outDir = join(root, "website/dist");
const siteUrl = "https://opencandle.app";
const brandName = "OpenCandle";
const landingDescription =
  "OpenCandle is an open source financial investigator with a local browser GUI and an equally complete terminal interface for evidence-first market research.";
const socialImage = `${siteUrl}/assets/gui-screenshot.png`;

// Ordered as a first-time visitor's journey: why and how to start, then daily
// use, then reference, then extending, then project meta. `navLabel` renames a
// page in the sidebar without touching its title, URL, or markdown.
const sourcePages = [
  {
    source: "docs/index.md",
    output: "docs/index.html",
    section: "Start here",
    navLabel: "Overview",
  },
  {
    source: "docs/comparisons.md",
    output: "docs/comparisons.html",
    section: "Start here",
    navLabel: "Why OpenCandle",
  },
  { source: "docs/getting-started.md", output: "docs/getting-started.html", section: "Start here" },
  { source: "docs/gui-quickstart.md", output: "docs/gui-quickstart.html", section: "Start here" },
  { source: "docs/first-run.md", output: "docs/first-run.html", section: "Start here" },
  { source: "docs/tui.md", output: "docs/tui.html", section: "Guides", navLabel: "Terminal (TUI)" },
  {
    source: "docs/investigation-recipes.md",
    output: "docs/investigation-recipes.html",
    section: "Guides",
  },
  { source: "docs/data-sources.md", output: "docs/data-sources.html", section: "Reference" },
  { source: "docs/configuration.md", output: "docs/configuration.html", section: "Reference" },
  {
    source: "docs/system-architecture.md",
    output: "docs/system-architecture.html",
    section: "Build",
  },
  { source: "docs/build-a-tool.md", output: "docs/build-a-tool.html", section: "Build" },
  { source: "docs/testing-and-evals.md", output: "docs/testing-and-evals.html", section: "Build" },
  {
    source: "CONTRIBUTING.md",
    output: "docs/contributing.html",
    section: "Project",
    navLabel: "Contributing",
  },
  { source: "SECURITY.md", output: "docs/security.html", section: "Project" },
];

// Previously published URLs whose pages were merged into consolidated docs.
// A static host cannot serve real redirects, so each old URL gets a stub that
// canonicalizes and refreshes to its new home.
const legacyRedirects = [
  { from: "docs/benchmarking.html", to: "docs/testing-and-evals.html#competitive-benchmarking" },
  {
    from: "docs/opencandle-vs-chatgpt.html",
    to: "docs/comparisons.html#opencandle-vs-chatgpt-and-general-chatbots",
  },
  {
    from: "docs/opencandle-vs-spreadsheets.html",
    to: "docs/comparisons.html#opencandle-vs-spreadsheets",
  },
];

const sourceToOutput = new Map(sourcePages.map((page) => [page.source, page.output]));
const basenameToOutput = new Map(
  sourcePages.map((page) => [page.source.split("/").at(-1), page.output]),
);

let sitePages = sourcePages;
let manifestEntry = null;

function markdownOutput(output) {
  return output.replace(/\.html$/, ".md");
}

function absoluteUrl(path) {
  return `${siteUrl}/${path.replace(/^index\.html$/, "").replace(/^\//, "")}`;
}

function relativeHref(targetOutput, fromOutput) {
  if (!fromOutput) return targetOutput;
  const fromDir = dirname(fromOutput);
  const target = relative(fromDir, targetOutput).replaceAll("\\", "/");
  return target === "" ? "." : target;
}

function rootPrefix(output) {
  return output.startsWith("docs/") ? "../" : "";
}

function resolveDocPath(rawPath, page) {
  if (rawPath === "./AGENTS.md" || rawPath === "AGENTS.md" || rawPath.endsWith("/AGENTS.md")) {
    return "AGENTS.md";
  }

  const pageDir = page.source.includes("/") ? page.source.split("/").slice(0, -1).join("/") : "";
  if (rawPath.startsWith("./") || rawPath.startsWith("../")) {
    return normalize(posix.join(pageDir, rawPath)).replaceAll("\\", "/");
  }
  return rawPath;
}

function rewriteLocalHref(href, page, mode) {
  if (/^(https?:|mailto:|#)/.test(href)) return href;

  const [rawPath, rawHash] = href.split("#");
  if (!rawPath) return href;

  const normalizedPath = resolveDocPath(rawPath, page);
  const basename = normalizedPath.split("/").at(-1);
  const mappedOutput = sourceToOutput.get(normalizedPath) ?? basenameToOutput.get(basename);
  const hash = rawHash ? `#${rawHash}` : "";

  if (mappedOutput) {
    return mode === "html"
      ? `${relativeHref(mappedOutput, page.output)}${hash}`
      : `${absoluteUrl(mappedOutput)}${hash}`;
  }

  if (normalizedPath.endsWith(".md")) {
    return `https://github.com/Kahtaf/OpenCandle/blob/main/${normalizedPath}${hash}`;
  }

  // Docs assets (images) are copied into dist under the same docs/ path.
  // Markdown mirrors and llms-full.txt are read from other origins/paths, so
  // they need the absolute site URL; HTML keeps the relative path.
  if (mode === "markdown" && normalizedPath.startsWith("docs/")) {
    return `${absoluteUrl(normalizedPath)}${hash}`;
  }

  return href;
}

function rewriteMarkdownLinksForSite(markdown, page) {
  return markdown.replace(/\]\(([^)]+)\)/g, (_match, target) => {
    const rewritten = rewriteLocalHref(target, page, "markdown");
    return `](${rewritten})`;
  });
}

function jsonLd(data) {
  return (
    <script
      type="application/ld+json"
      // biome-ignore lint/security/noDangerouslySetInnerHtml: Static JSON-LD is generated from local metadata at build time.
      dangerouslySetInnerHTML={{ __html: JSON.stringify(data).replaceAll("<", "\\u003c") }}
    />
  );
}

function createSlugger() {
  const seen = new Map();
  return (value) => {
    const base =
      value
        .toLowerCase()
        .replace(/`([^`]+)`/g, "$1")
        .replace(/<[^>]+>/g, "")
        .replace(/[^a-z0-9\s-]/g, "")
        .trim()
        .replace(/\s+/g, "-") || "section";
    const count = seen.get(base) ?? 0;
    seen.set(base, count + 1);
    return count === 0 ? base : `${base}-${count}`;
  };
}

function rewriteLinksPlugin(page) {
  return (tree) => {
    visit(tree, ["link", "image"], (node) => {
      if (typeof node.url === "string") {
        node.url = rewriteLocalHref(node.url, page, "html");
      }
    });
  };
}

function collectHeadingsPlugin(headings) {
  return (tree) => {
    const slug = createSlugger();
    visit(tree, "heading", (node) => {
      const text = mdastToString(node).trim();
      if (!text) return;
      const id = slug(text);
      node.data ??= {};
      node.data.hProperties = { ...(node.data.hProperties ?? {}), id };
      headings.push({ level: node.depth, text, id });
    });
  };
}

async function renderMarkdown(body, page) {
  const headings = [];
  const file = await unified()
    .use(remarkParse)
    .use(remarkGfm)
    .use(rewriteLinksPlugin, page)
    .use(collectHeadingsPlugin, headings)
    .use(remarkRehype)
    .use(rehypeSlug)
    .use(rehypeAutolinkHeadings, { behavior: "wrap" })
    .use(rehypeStringify)
    .process(body);

  return { html: String(file), headings };
}

function extractTitle(body, fallback) {
  const tree = unified().use(remarkParse).parse(body);
  let title = null;
  visit(tree, "heading", (node) => {
    if (title == null && node.depth === 1) {
      title = mdastToString(node).trim();
    }
  });
  return title ?? fallback;
}

function assetTags(output) {
  const prefix = rootPrefix(output);
  const cssTags = (manifestEntry.css ?? []).map((file) => (
    <link key={file} rel="stylesheet" href={`${prefix}${file}`} />
  ));
  return [...cssTags, <script key="entry" type="module" src={`${prefix}${manifestEntry.file}`} />];
}

function sharedHeadTags({ title, description, canonicalUrl, image = socialImage, markdownUrl }) {
  return (
    <>
      <link rel="canonical" href={canonicalUrl} />
      <meta property="og:site_name" content={brandName} />
      <meta property="og:type" content="website" />
      <meta property="og:title" content={title} />
      <meta property="og:description" content={description} />
      <meta property="og:url" content={canonicalUrl} />
      <meta property="og:image" content={image} />
      <meta name="twitter:card" content="summary_large_image" />
      <meta name="twitter:title" content={title} />
      <meta name="twitter:description" content={description} />
      <meta name="twitter:image" content={image} />
      <link
        rel="alternate"
        type="text/plain"
        href={`${siteUrl}/llms.txt`}
        title="OpenCandle AI guide"
      />
      <link rel="alternate" type="text/markdown" href={markdownUrl} title="Markdown version" />
    </>
  );
}

function HtmlDocument({
  title,
  description,
  canonicalUrl,
  markdownUrl,
  output,
  children,
  structuredData,
}) {
  const prefix = rootPrefix(output);
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <meta name="description" content={description} />
        <meta name="author" content="Kahtaf" />
        <title>{title}</title>
        {sharedHeadTags({ title, description, canonicalUrl, markdownUrl })}
        <link rel="icon" href={`${prefix}assets/logo.svg`} type="image/svg+xml" />
        <link rel="alternate icon" href={`${prefix}favicon.ico`} />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link
          href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap"
          rel="stylesheet"
        />
        {assetTags(output)}
        {jsonLd(structuredData)}
      </head>
      <body>{children}</body>
    </html>
  );
}

// One navigation for the whole site: the same sticky navbar renders on the
// homepage and every docs page, with the docs tree one hamburger away on
// mobile. This mirrors the standard docs-site shell (navbar everywhere,
// sidebar under it on docs pages).
function SiteHeader({ output = "index.html" }) {
  const prefix = rootPrefix(output);
  const onComparisons = output === "docs/comparisons.html";
  const onDocs = output.startsWith("docs/") && !onComparisons;
  const activeClass = "text-foreground";
  return (
    <header className="sticky top-0 z-20 border-border border-b bg-background/95 backdrop-blur">
      <div className="mx-auto flex h-14 max-w-[1320px] items-center gap-2 px-4 lg:px-6">
        <Button
          variant="ghost"
          size="icon-sm"
          className="md:hidden"
          aria-label="Open navigation"
          data-drawer-open=""
        >
          <MenuIcon />
        </Button>
        <a
          className="flex items-center gap-2 rounded-md font-semibold text-sm tracking-tight focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          href={`${prefix}index.html`}
        >
          <OpenCandleLogo src={`${prefix}assets/logo.svg`} className="h-5 w-5" />
          <span>OpenCandle</span>
        </a>
        <nav className="ml-auto flex items-center gap-1 text-sm" aria-label="Primary navigation">
          <Button asChild variant="ghost" size="sm" className={onDocs ? activeClass : undefined}>
            <a href={`${prefix}docs/index.html`} aria-current={onDocs ? "true" : undefined}>
              Docs
            </a>
          </Button>
          <Button
            asChild
            variant="ghost"
            size="sm"
            className={`hidden sm:inline-flex ${onComparisons ? activeClass : ""}`}
          >
            <a
              href={`${prefix}docs/comparisons.html`}
              aria-current={onComparisons ? "true" : undefined}
            >
              Comparisons
            </a>
          </Button>
          <Button asChild variant="ghost" size="sm" className="hidden sm:inline-flex">
            <a href="https://github.com/Kahtaf/OpenCandle">GitHub</a>
          </Button>
          <Button asChild variant="brand" size="sm" rounded="full">
            <a href={`${prefix}docs/getting-started.html`}>Install</a>
          </Button>
        </nav>
      </div>
    </header>
  );
}

function SiteFooter({ output = "index.html" }) {
  const prefix = rootPrefix(output);
  const groups = [
    {
      label: "Product",
      links: [
        ["Overview", `${prefix}index.html`],
        ["Getting started", `${prefix}docs/getting-started.html`],
        ["Data sources", `${prefix}docs/data-sources.html`],
        ["Comparisons", `${prefix}docs/comparisons.html`],
      ],
    },
    {
      label: "Build",
      links: [
        ["System architecture", `${prefix}docs/system-architecture.html`],
        ["Build a tool", `${prefix}docs/build-a-tool.html`],
        ["Testing and evals", `${prefix}docs/testing-and-evals.html`],
        ["Contributing", `${prefix}docs/contributing.html`],
      ],
    },
    {
      label: "Project",
      links: [
        ["GitHub", "https://github.com/Kahtaf/OpenCandle"],
        ["npm", "https://www.npmjs.com/package/opencandle"],
        ["Changelog", "https://github.com/Kahtaf/OpenCandle/blob/main/CHANGELOG.md"],
        ["Security", `${prefix}docs/security.html`],
      ],
    },
  ];
  return (
    <footer className="site-footer border-border border-t">
      <div className="mx-auto grid max-w-[1100px] gap-12 px-4 py-14 sm:grid-cols-[1.5fr_2fr] lg:px-6">
        <div className="max-w-[300px]">
          <a className="flex items-center gap-2 font-semibold text-sm" href={`${prefix}index.html`}>
            <OpenCandleLogo src={`${prefix}assets/logo.svg`} className="h-5 w-5" />
            <span>OpenCandle</span>
          </a>
          <p className="mt-4 text-muted-foreground text-sm leading-relaxed">
            Local-first financial research that gathers the live record and shows its evidence.
          </p>
          <p className="mt-5 font-mono text-muted-foreground text-xs">MIT licensed · read-only</p>
        </div>
        <nav className="grid grid-cols-2 gap-8 sm:grid-cols-3" aria-label="Footer">
          {groups.map((group) => (
            <div key={group.label}>
              <p className="font-medium text-[11px] text-foreground uppercase tracking-wider">
                {group.label}
              </p>
              <ul className="mt-4 space-y-3 text-sm">
                {group.links.map(([label, href]) => (
                  <li key={label}>
                    <a
                      href={href}
                      className="rounded-md text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      {label}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </nav>
      </div>
      <div className="mx-auto max-w-[1100px] border-border border-t px-4 py-5 text-muted-foreground text-xs lg:px-6">
        OpenCandle is research software, not financial advice. It does not place trades.
      </div>
    </footer>
  );
}

// Inline copies of the lucide icons the GUI shell uses (Menu, PanelLeft,
// PanelLeftOpen) so the static site does not need the lucide-react dependency.
function LucideIcon({ children, className }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      className={className}
    >
      {children}
    </svg>
  );
}

function MenuIcon() {
  return (
    <LucideIcon>
      <line x1="4" x2="20" y1="6" y2="6" />
      <line x1="4" x2="20" y1="12" y2="12" />
      <line x1="4" x2="20" y1="18" y2="18" />
    </LucideIcon>
  );
}

function PortfolioIcon() {
  return (
    <LucideIcon className="evidence-source-logo">
      <rect x="3" y="7" width="18" height="13" rx="2" />
      <path d="M8 7V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
      <path d="M3 12h18" />
      <path d="M12 12v3" />
    </LucideIcon>
  );
}

// Kept as an inert fallback while the Remotion surface demo is evaluated.
// Restoring the handcrafted animation only requires rendering this component
// in place of SurfaceDemo.
function LegacyCliDemo() {
  return (
    <div
      className="cli-demo"
      role="img"
      aria-label="OpenCandle terminal demonstration"
      data-cli-demo=""
    >
      <div className="cli-chrome" aria-hidden="true">
        <span />
        <span />
        <span />
        <p>~/research/opencandle</p>
        <Badge variant="outline">local session</Badge>
      </div>
      <div className="cli-screen" aria-hidden="true">
        <p className="cli-line cli-line-command">
          <span className="cli-prompt">$</span> npx opencandle@latest
        </p>
        <p className="cli-line cli-line-question">
          <span className="cli-prompt">›</span> Analyze NVDA with filings, options, sentiment, and
          macro context.
        </p>
        <div className="cli-progress">
          <p className="cli-line">
            <span className="cli-check">✓</span> Quote and price history{" "}
            <em>Yahoo Finance · now</em>
          </p>
          <p className="cli-line">
            <span className="cli-check">✓</span> Latest 10-Q and 8-K <em>SEC EDGAR</em>
          </p>
          <p className="cli-line">
            <span className="cli-check">✓</span> Option chain + Greeks <em>local calculation</em>
          </p>
          <p className="cli-line">
            <span className="cli-check">✓</span> Rates and inflation <em>FRED</em>
          </p>
        </div>
        <p className="cli-line cli-answer">
          Evidence gathered. Writing the answer with sources and visible gaps…
          <span className="cli-cursor" />
        </p>
      </div>
    </div>
  );
}

function SurfaceDemo() {
  return (
    <div className="surface-demo" data-surface-demo="">
      <div className="surface-demo-toolbar">
        <div className="surface-demo-tabs" role="tablist" aria-label="Choose an OpenCandle view">
          <button
            id="surface-tab-gui"
            type="button"
            role="tab"
            aria-selected="true"
            aria-controls="surface-panel-gui"
            tabIndex="0"
            data-surface-tab="gui"
          >
            Browser
          </button>
          <button
            id="surface-tab-tui"
            type="button"
            role="tab"
            aria-selected="false"
            aria-controls="surface-panel-tui"
            tabIndex="-1"
            data-surface-tab="tui"
          >
            Terminal
          </button>
        </div>
        <p>One engine. Two complete interfaces.</p>
      </div>
      <div className="surface-demo-stage">
        <div
          id="surface-panel-gui"
          role="tabpanel"
          aria-labelledby="surface-tab-gui"
          data-surface-panel="gui"
        >
          <video
            aria-label="OpenCandle browser workflow animation"
            data-surface-video="gui"
            src="assets/gui-demo.mp4"
            poster="assets/gui-demo-poster.png"
            controls
            muted
            loop
            playsInline
            preload="metadata"
          />
        </div>
        <div
          id="surface-panel-tui"
          role="tabpanel"
          aria-labelledby="surface-tab-tui"
          data-surface-panel="tui"
          hidden
        >
          <video
            aria-label="OpenCandle terminal workflow animation"
            data-surface-video="tui"
            data-src="assets/tui-demo.mp4"
            poster="assets/tui-demo-poster.png"
            controls
            muted
            loop
            playsInline
            preload="none"
          />
        </div>
      </div>
      <p className="surface-demo-caption">
        Start visually in the GUI. Prefer the terminal? The same complete research path is there.
      </p>
    </div>
  );
}

function SectionLabel({ children }) {
  return (
    <p className="flex items-center gap-1.5 px-2 pt-2 font-medium text-[11px] text-muted-foreground uppercase tracking-wider">
      {children}
    </p>
  );
}

function NavGroups({ activeOutput }) {
  const groups = new Map();
  for (const page of sitePages) {
    if (!groups.has(page.section)) groups.set(page.section, []);
    groups.get(page.section).push(page);
  }

  return [...groups.entries()].map(([section, items]) => (
    <div key={section} className="flex flex-col gap-0.5">
      <SectionLabel>{section}</SectionLabel>
      {items.map((page) => (
        <a
          key={page.output}
          href={relativeHref(page.output, activeOutput)}
          aria-current={page.output === activeOutput ? "page" : undefined}
          className="block rounded-md px-2 py-1.5 text-muted-foreground text-sm transition-colors hover:bg-tertiary hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring aria-[current=page]:bg-tertiary aria-[current=page]:font-medium aria-[current=page]:text-foreground"
        >
          {page.navLabel ?? page.title}
        </a>
      ))}
    </div>
  ));
}

function ResourceLinks() {
  return (
    <div className="flex flex-col gap-0.5">
      <SectionLabel>Resources</SectionLabel>
      {[
        ["GitHub", "https://github.com/Kahtaf/OpenCandle"],
        ["npm", "https://www.npmjs.com/package/opencandle"],
        ["Changelog", "https://github.com/Kahtaf/OpenCandle/blob/main/CHANGELOG.md"],
      ].map(([label, href]) => (
        <a
          key={label}
          href={href}
          className="block rounded-md px-2 py-1.5 text-muted-foreground text-sm transition-colors hover:bg-tertiary hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {label}
        </a>
      ))}
    </div>
  );
}

function DocsNav({ activeOutput }) {
  return (
    <nav
      aria-label="Documentation"
      className="flex h-full min-h-0 flex-col gap-5 overflow-y-auto px-3 py-5"
    >
      <NavGroups activeOutput={activeOutput} />
      <ResourceLinks />
    </nav>
  );
}

// The mobile bottom drawer holds the same docs tree on every page, homepage
// included, so navigation is one gesture away site-wide.
function SiteDrawer({ output }) {
  return (
    <div data-docs-drawer="" hidden>
      <div
        data-drawer-overlay=""
        className="fixed inset-0 z-40 bg-foreground/30 backdrop-blur-[2px]"
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Site navigation"
        data-drawer-panel=""
        className="fixed inset-x-2 bottom-0 z-50 flex h-[min(88dvh,calc(100dvh-64px))] max-h-[min(88dvh,calc(100dvh-64px))] flex-col overflow-hidden rounded-t-xl border border-border bg-secondary shadow-subtle-md"
      >
        <div
          className="mx-auto mt-3 mb-2 h-1 w-9 shrink-0 rounded-full bg-hard"
          aria-hidden="true"
        />
        <div className="flex min-h-0 flex-1 flex-col">
          <DocsNav activeOutput={output} />
        </div>
      </div>
    </div>
  );
}

function DocsShell({ page, children }) {
  return (
    <>
      <SiteHeader output={page.output} />
      <div className="mx-auto flex w-full max-w-[1320px]">
        <aside className="sticky top-14 hidden h-[calc(100dvh-3.5rem)] w-[260px] shrink-0 overflow-hidden border-border border-r bg-secondary md:block">
          <DocsNav activeOutput={page.output} />
        </aside>
        <div className="flex min-w-0 flex-1 flex-col">{children}</div>
      </div>
      <SiteFooter output={page.output} />
      <SiteDrawer output={page.output} />
    </>
  );
}

function HomePage({ buildDate, version }) {
  const faqs = [
    {
      question: "What is OpenCandle?",
      answer:
        "OpenCandle is an open source financial investigator built around a local browser GUI, with an equally complete terminal interface for users who prefer a keyboard-first workflow.",
    },
    {
      question: "How is this different from asking ChatGPT?",
      answer:
        "A general chatbot answers from training data unless you wire up browsing and data feeds yourself. OpenCandle calls typed finance tools first — quotes, filings, options chains, macro series, sentiment — and keeps the provider trail, timestamps, and data gaps visible in the answer.",
    },
    {
      question: "Which model does it use?",
      answer:
        "You bring your own model credentials — Anthropic, OpenAI, or Google — through the bundled Pi agent runtime. Market data is separate: Yahoo Finance, SEC EDGAR, FRED, and CoinGecko work without any data-provider keys.",
    },
    {
      question: "Does OpenCandle place trades?",
      answer:
        "No. OpenCandle is read-only research software. It gathers and organizes market evidence, but it does not place trades, route orders, or provide financial advice.",
    },
    {
      question: "Which data sources does OpenCandle use?",
      answer:
        "OpenCandle integrates Yahoo Finance, TradingView scanner, Alpha Vantage, London Strategic Edge, FRED, Polymarket, CoinGecko, Reddit, SEC EDGAR, DuckDuckGo, Brave, Exa, Finnhub, and local portfolio state where configured.",
    },
  ];
  const dataSources = [
    {
      name: "Yahoo Finance",
      capability: "quotes + options",
      icons: ["assets/source-icons/yahoo.svg"],
    },
    {
      name: "SEC EDGAR",
      capability: "company filings",
      icons: ["assets/source-icons/sec.svg"],
    },
    {
      name: "FRED",
      capability: "macro series",
      icons: ["assets/source-icons/fred.svg"],
      iconClass: "evidence-source-logo--fred",
    },
    {
      name: "TradingView",
      capability: "market screeners",
      icons: ["assets/source-icons/tradingview.svg"],
    },
    {
      name: "CoinGecko",
      capability: "crypto markets",
      icons: ["assets/source-icons/coingecko.png"],
    },
    {
      name: "Polymarket",
      capability: "prediction markets",
      icons: ["assets/source-icons/polymarket.ico"],
    },
    {
      name: "Reddit",
      capability: "market sentiment",
      icons: ["assets/source-icons/reddit.svg"],
    },
    {
      name: "Exa",
      capability: "web research",
      icons: ["assets/source-icons/exa.svg"],
    },
    {
      name: "Brave",
      capability: "web search",
      icons: ["assets/source-icons/brave.svg"],
    },
    {
      name: "Alpha Vantage",
      capability: "market data",
      icons: ["assets/source-icons/alpha-vantage.ico"],
    },
    { name: "Local portfolio", capability: "your positions", icons: [] },
  ];
  const researchSteps = [
    {
      mark: "01",
      title: "Ask in plain English",
      body: "Start with a company, portfolio, market event, or thesis. OpenCandle turns the question into a research plan.",
    },
    {
      mark: "02",
      title: "Gather the live record",
      body: "Typed tools fetch quotes, filings, options, macro series, news, and sentiment before the answer is written.",
    },
    {
      mark: "03",
      title: "Inspect every claim",
      body: "Providers, timestamps, tool calls, and missing-data notes stay attached so you can verify the work.",
    },
  ];

  return (
    <HtmlDocument
      title="OpenCandle"
      description={landingDescription}
      canonicalUrl={siteUrl}
      markdownUrl={`${siteUrl}/llms-full.txt`}
      output="index.html"
      structuredData={{
        "@context": "https://schema.org",
        "@graph": [
          {
            "@type": "Organization",
            "@id": `${siteUrl}/#organization`,
            name: brandName,
            url: siteUrl,
            logo: `${siteUrl}/assets/logo.svg`,
            sameAs: [
              "https://github.com/Kahtaf/OpenCandle",
              "https://www.npmjs.com/package/opencandle",
            ],
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
            softwareVersion: version,
            url: siteUrl,
            codeRepository: "https://github.com/Kahtaf/OpenCandle",
            downloadUrl: "https://www.npmjs.com/package/opencandle",
            license: "https://github.com/Kahtaf/OpenCandle/blob/main/LICENSE",
            description: landingDescription,
          },
          {
            "@type": "FAQPage",
            mainEntity: faqs.map((faq) => ({
              "@type": "Question",
              name: faq.question,
              acceptedAnswer: { "@type": "Answer", text: faq.answer },
            })),
          },
        ],
      }}
    >
      <SiteHeader />
      <main>
        <section className="landing-hero mx-auto max-w-[1100px] px-4 pt-16 pb-12 text-center sm:pt-24 lg:px-6">
          <div className="flex items-center justify-center gap-2">
            <Badge variant="outline">Local-first</Badge>
            <Badge variant="outline">
              <a href="https://github.com/Kahtaf/OpenCandle/blob/main/CHANGELOG.md">v{version}</a>
            </Badge>
          </div>
          <h1 className="mx-auto mt-6 max-w-[860px] font-semibold text-4xl text-foreground tracking-[-0.045em] sm:text-6xl lg:text-7xl">
            Ask the market. <span className="text-accent">Inspect the evidence.</span>
          </h1>
          <p className="mx-auto mt-6 max-w-[660px] text-base text-muted-foreground leading-relaxed sm:text-lg">
            OpenCandle is a local-first financial research workspace. Start in the visual GUI to
            gather live market data, filings, macro context, options, and sentiment—then inspect
            every source behind the answer.
          </p>
          <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
            <Button asChild variant="brand" rounded="full">
              <a href="docs/gui-quickstart.html">Start with the GUI</a>
            </Button>
            <Button asChild variant="bordered">
              <a href="docs/tui.html">Prefer the terminal</a>
            </Button>
          </div>
          <p className="mt-4 text-muted-foreground text-xs">
            Open source · read-only · your model key · market data needs no keys
          </p>
        </section>

        <section
          className="mx-auto max-w-[1100px] px-4 pb-24 lg:px-6"
          aria-label="OpenCandle in the browser and terminal"
        >
          <SurfaceDemo />
          <template data-legacy-cli-demo="">
            <LegacyCliDemo />
          </template>

          <div className="evidence-map">
            <div className="evidence-map-heading">
              <p className="landing-eyebrow">Typed tools · live providers</p>
              <h2>The tools behind every answer</h2>
              <p>
                OpenCandle picks the relevant sources for the question and keeps each one attached
                to the result.
              </p>
            </div>
            <div className="evidence-hub" aria-hidden="true">
              <span className="evidence-hub-mark">
                <OpenCandleLogo src="assets/logo.svg" className="h-7 w-7" />
              </span>
              <span className="evidence-hub-label">OpenCandle</span>
            </div>
            <svg
              className="evidence-branches"
              viewBox="0 0 1000 112"
              preserveAspectRatio="none"
              aria-hidden="true"
            >
              <defs>
                <linearGradient id="evidence-branch-gradient" x1="0" y1="0" x2="0" y2="1">
                  <stop className="evidence-branch-start" offset="0" />
                  <stop className="evidence-branch-end" offset="1" />
                </linearGradient>
              </defs>
              <path className="evidence-branch--desktop" d="M500 0 C500 54 100 35 100 112" />
              <path className="evidence-branch--desktop" d="M500 0 C500 50 300 38 300 112" />
              <path
                className="evidence-branch--desktop evidence-branch--center"
                d="M500 0 L500 112"
              />
              <path className="evidence-branch--desktop" d="M500 0 C500 50 700 38 700 112" />
              <path className="evidence-branch--desktop" d="M500 0 C500 54 900 35 900 112" />
              <path className="evidence-branch--mobile" d="M500 0 C500 42 250 38 250 112" />
              <path className="evidence-branch--mobile" d="M500 0 C500 42 750 38 750 112" />
            </svg>
            <div className="evidence-grid">
              {dataSources.map(({ name, capability, icons, iconClass }, index) => (
                <Card key={name} className="evidence-source-card">
                  <span className="evidence-source-logos" aria-hidden="true">
                    {icons.length > 0 ? (
                      icons.map((src) => (
                        <img
                          key={src}
                          className={`evidence-source-logo${iconClass ? ` ${iconClass}` : ""}`}
                          src={src}
                          alt=""
                          width="30"
                          height="30"
                          loading="lazy"
                          decoding="async"
                        />
                      ))
                    ) : (
                      <PortfolioIcon />
                    )}
                  </span>
                  <span>
                    <strong>{name}</strong>
                    <small>{capability}</small>
                  </span>
                  {index <= 5 ? (
                    <span
                      className="evidence-row-connector evidence-row-connector--desktop"
                      aria-hidden="true"
                    />
                  ) : null}
                  {index <= 8 ? (
                    <span
                      className="evidence-row-connector evidence-row-connector--mobile"
                      aria-hidden="true"
                    />
                  ) : null}
                </Card>
              ))}
              <a className="evidence-source-more" href="docs/data-sources.html">
                See every data source <span aria-hidden="true">→</span>
              </a>
            </div>
          </div>
        </section>

        <section
          className="mx-auto max-w-[1100px] px-4 pb-24 lg:px-6"
          aria-labelledby="research-flow-title"
        >
          <div className="landing-section-heading">
            <p className="landing-eyebrow">How it works</p>
            <h2 id="research-flow-title">Ask. Gather. Verify.</h2>
            <p>The agent does the collection work. You keep the judgment.</p>
          </div>
          <div className="research-steps">
            {researchSteps.map((step) => (
              <article key={step.mark} className="research-step">
                <span className="research-step-mark" aria-hidden="true">
                  {step.mark}
                </span>
                <h3>{step.title}</h3>
                <p>{step.body}</p>
              </article>
            ))}
          </div>
        </section>

        <section className="border-border border-y bg-secondary/50">
          <div className="mx-auto max-w-[1100px] px-4 py-16 lg:px-6">
            <h2 className="font-semibold text-foreground text-xl tracking-[-0.01em]">
              Why not just ask a chatbot?
            </h2>
            <div className="mt-6 grid gap-5 md:grid-cols-2">
              <Card className="p-6">
                <h3 className="font-semibold text-base">A general chatbot</h3>
                <ul className="mt-4 space-y-3 text-muted-foreground text-sm">
                  <li>Answers from training data unless you wire up browsing</li>
                  <li>Invents or omits numbers</li>
                  <li>Sources only if you add them yourself</li>
                  <li>Confident even when stale</li>
                </ul>
              </Card>
              <Card className="p-6">
                <h3 className="font-semibold text-base">OpenCandle</h3>
                <ul className="mt-4 space-y-3 text-muted-foreground text-sm">
                  <li>Fetches live data before answering</li>
                  <li>Uses provider numbers as fetched</li>
                  <li>Names sources and timestamps</li>
                  <li>States gaps outright</li>
                </ul>
              </Card>
            </div>
            <p className="mt-6 text-sm">
              <a
                className="font-medium text-foreground underline underline-offset-4 hover:text-muted-foreground"
                href="docs/comparisons.html"
              >
                See the full comparison
              </a>
            </p>
          </div>
        </section>

        <section className="mx-auto max-w-[1100px] px-4 py-24 lg:px-6">
          <div className="landing-section-heading landing-section-heading-left">
            <p className="landing-eyebrow">One local workspace</p>
            <h2>Research in the browser or the terminal</h2>
            <p>
              The GUI is the primary path. The equally complete terminal interface uses the same
              sessions, tools, watchlists, portfolios, alerts, reports, and evidence trail.
            </p>
          </div>
          <ul className="surface-tabs" aria-label="OpenCandle interfaces">
            <li>
              <strong>Browser workbench</strong>
              <small>Visual evidence trail</small>
            </li>
            <li>
              <strong>Terminal agent</strong>
              <small>Complete keyboard-first research</small>
            </li>
            <li>
              <strong>Typed tools</strong>
              <small>Extensible by design</small>
            </li>
          </ul>
          <Card className="workbench-frame overflow-hidden">
            <img
              src="assets/gui-screenshot.png"
              alt="OpenCandle local GUI answering a market question with a quote table, cited sources, and the research steps panel"
              width="1440"
              height="960"
              className="block w-full"
              fetchPriority="high"
            />
          </Card>
          <p className="mt-4 text-center text-muted-foreground text-xs">
            <a
              className="font-medium text-foreground underline underline-offset-4 hover:text-muted-foreground"
              href="https://github.com/user-attachments/assets/334956b1-18b4-4d6f-92b5-3f739824cd29"
            >
              Watch the full product walkthrough
            </a>
          </p>
        </section>

        <section className="mx-auto max-w-[1100px] px-4 pb-20 lg:px-6" aria-label="For builders">
          <div className="grid items-start gap-10 md:grid-cols-2">
            <div>
              <h2 className="font-semibold text-foreground text-xl tracking-[-0.01em]">
                Built to be extended
              </h2>
              <p className="mt-3 text-muted-foreground text-sm leading-relaxed">
                Every capability is a typed tool: declared parameters, shared caching, rate limits.
                Add a data source in one file, or ship it as an npm package.
              </p>
              <ul className="mt-5 space-y-3 text-sm">
                {[
                  ["Build a tool", "docs/build-a-tool.html"],
                  ["System architecture", "docs/system-architecture.html"],
                  ["Testing and evals", "docs/testing-and-evals.html"],
                ].map(([label, href]) => (
                  <li key={label}>
                    <a
                      className="font-medium text-foreground underline underline-offset-4 hover:text-muted-foreground"
                      href={href}
                    >
                      {label}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
            <pre className="min-w-0 max-w-full overflow-x-auto rounded-lg border border-border bg-secondary p-4 font-mono text-xs leading-relaxed">
              <code>{`import { Type } from "@sinclair/typebox";

const params = Type.Object({
  symbol: Type.String({ description: "Ticker symbol" }),
});

export const twitterSentimentTool: AgentTool<typeof params> = {
  name: "get_twitter_sentiment",
  label: "Twitter Sentiment",
  parameters: params,
  async execute(toolCallId, args) {
    // fetch via provider, return typed evidence
    return {
      content: [{ type: "text", text: "Formatted output" }],
      details: { sentiment: 0.72, volume: 1234 },
    };
  },
};`}</code>
            </pre>
          </div>
        </section>

        <section
          className="landing-cta border-border border-y bg-secondary/60"
          aria-label="Start locally"
        >
          <div className="mx-auto max-w-[1100px] px-4 py-20 text-center lg:px-6">
            <p className="landing-eyebrow">One command. Your machine.</p>
            <h2>Start your first investigation.</h2>
            <p>Bring an Anthropic, OpenAI, or Google model key. Market data needs no keys.</p>
            <div className="landing-command">
              <span aria-hidden="true">$</span>
              <code>npx opencandle@latest gui</code>
            </div>
            <div className="mt-6 flex flex-wrap justify-center gap-3">
              <Button asChild variant="brand" rounded="full">
                <a href="docs/getting-started.html">Install OpenCandle</a>
              </Button>
              <Button asChild variant="bordered">
                <a href="docs/first-run.html">See the first run</a>
              </Button>
            </div>
            <p className="mt-5 text-muted-foreground text-xs">
              MIT licensed · Node.js 22.19+ (22.x) or 24–26 · macOS, Windows, Linux
            </p>
          </div>
        </section>

        <section className="mx-auto max-w-[860px] px-4 py-24 lg:px-6" aria-label="FAQ">
          <div className="landing-section-heading">
            <p className="landing-eyebrow">FAQ</p>
            <h2>Common questions</h2>
          </div>
          <div className="faq-list">
            {faqs.map((faq) => (
              <details key={faq.question}>
                <summary>
                  {faq.question}
                  <span aria-hidden="true">+</span>
                </summary>
                <p>{faq.answer}</p>
              </details>
            ))}
          </div>
        </section>
      </main>
      <SiteFooter />
      <SiteDrawer output="index.html" />
    </HtmlDocument>
  );
}

function DocsPage({ page, content, headings, buildDate }) {
  const canonicalUrl = absoluteUrl(page.output);
  const markdownUrl = absoluteUrl(markdownOutput(page.output));
  const toc = headings.filter((heading) => heading.level === 2);

  return (
    <HtmlDocument
      title={`${page.title} - OpenCandle`}
      description={page.description}
      canonicalUrl={canonicalUrl}
      markdownUrl={markdownUrl}
      output={page.output}
      structuredData={{
        "@context": "https://schema.org",
        "@type": "TechArticle",
        headline: `${page.title} - ${brandName}`,
        description: page.description,
        datePublished: buildDate,
        dateModified: buildDate,
        author: {
          "@type": "Person",
          name: "Kahtaf",
          url: "https://github.com/Kahtaf",
        },
        publisher: {
          "@type": "Organization",
          name: brandName,
          url: siteUrl,
          sameAs: [
            "https://github.com/Kahtaf/OpenCandle",
            "https://www.npmjs.com/package/opencandle",
          ],
        },
        mainEntityOfPage: canonicalUrl,
      }}
    >
      <DocsShell page={page}>
        <main className="mx-auto flex w-full max-w-[1100px] gap-12 px-4 py-10 sm:px-6 lg:px-10">
          <article className="min-w-0 max-w-[720px] flex-1">
            <p className="mb-6 text-muted-foreground text-xs">
              Last updated <time dateTime={buildDate}>{buildDate}</time>
            </p>
            <div
              className="docs-content"
              // biome-ignore lint/security/noDangerouslySetInnerHtml: Markdown is trusted repo-local content rendered during the static build.
              dangerouslySetInnerHTML={{ __html: content }}
            />
          </article>
          {toc.length > 0 ? (
            <aside className="hidden w-[200px] shrink-0 xl:block">
              <div className="sticky top-20 flex flex-col gap-0.5">
                <SectionLabel>On this page</SectionLabel>
                <nav className="flex flex-col gap-0.5" aria-label="On this page">
                  {toc.map((heading) => (
                    <a
                      key={heading.id}
                      href={`#${heading.id}`}
                      className="block rounded-md px-2 py-1.5 text-muted-foreground text-sm transition-colors hover:bg-secondary hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      {heading.text}
                    </a>
                  ))}
                </nav>
              </div>
            </aside>
          ) : null}
        </main>
      </DocsShell>
    </HtmlDocument>
  );
}

function renderDocument(component) {
  return `<!doctype html>${renderToStaticMarkup(component)}`;
}

async function loadPages() {
  const loaded = [];
  for (const page of sourcePages) {
    const markdown = await readFile(join(root, page.source), "utf8");
    const parsed = matter(markdown);
    const body = parsed.content.trimStart();
    loaded.push({
      ...page,
      body,
      title: parsed.data.title ?? extractTitle(body, page.source),
      description: parsed.data.description ?? "OpenCandle documentation.",
    });
  }
  return loaded;
}

async function loadManifest() {
  const manifest = JSON.parse(await readFile(join(outDir, ".vite/manifest.json"), "utf8"));
  manifestEntry =
    manifest["src/entry-client.jsx"] ?? Object.values(manifest).find((entry) => entry.isEntry);
  if (!manifestEntry) {
    throw new Error("Unable to find website Vite manifest entry.");
  }
}

async function copyStaticAssets() {
  await mkdir(join(outDir, "assets"), { recursive: true });
  await copyFile(join(root, "assets/logo.svg"), join(outDir, "assets/logo.svg"));
  await cp(join(root, "website/assets"), join(outDir, "assets"), { recursive: true });
  await cp(join(root, "docs/images"), join(outDir, "docs/images"), { recursive: true });
  await Promise.all([
    copyFile(join(root, "video/public/approved/gui.mp4"), join(outDir, "assets/gui-demo.mp4")),
    copyFile(join(root, "video/public/approved/tui.mp4"), join(outDir, "assets/tui-demo.mp4")),
    copyFile(
      join(root, "video/public/approved/gui-start.png"),
      join(outDir, "assets/gui-demo-poster.png"),
    ),
    copyFile(
      join(root, "video/public/approved/tui-final.png"),
      join(outDir, "assets/tui-demo-poster.png"),
    ),
  ]);
  await copyFile(join(root, "website/assets/favicon.ico"), join(outDir, "favicon.ico"));
  await copyFile(join(root, "AGENTS.md"), join(outDir, "AGENTS.md"));
}

function renderLlmsTxt(pages, buildDate) {
  return `# OpenCandle

> Open source financial investigator for quotes, fundamentals, macro data, filings, options, sentiment, and portfolio workflows.

Last updated: ${buildDate}

## Start here

- [Overview](${siteUrl}/docs/index.html)
- [Getting started](${siteUrl}/docs/getting-started.html)
- [GUI quickstart](${siteUrl}/docs/gui-quickstart.html)
- [Data sources](${siteUrl}/docs/data-sources.html)
- [Build a tool](${siteUrl}/docs/build-a-tool.html)

## Public documentation

${pages.map((page) => `- [${page.title}](${absoluteUrl(page.output)}): ${page.description}`).join("\n")}

## Source

- GitHub: https://github.com/Kahtaf/OpenCandle
- npm: https://www.npmjs.com/package/opencandle
`;
}

function renderLlmsFullTxt(pages, buildDate) {
  const sections = pages.map(
    (page) =>
      `# ${page.title}\n\nSource: ${absoluteUrl(page.output)}\n\n${rewriteMarkdownLinksForSite(page.body, page).trim()}`,
  );

  return `# OpenCandle Full Documentation

Last updated: ${buildDate}

OpenCandle is an open source financial research agent. It gathers evidence through explicit tools, records provider gaps, and then synthesizes answers from gathered evidence.

${sections.join("\n\n---\n\n")}
`;
}

function renderRedirectDocument(targetUrl) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="robots" content="noindex" />
<link rel="canonical" href="${targetUrl}" />
<meta http-equiv="refresh" content="0; url=${targetUrl}" />
<title>Redirecting</title>
</head>
<body>
<p>This page has moved to <a href="${targetUrl}">${targetUrl}</a>.</p>
</body>
</html>
`;
}

async function writeLegacyRedirects() {
  for (const { from, to } of legacyRedirects) {
    const targetUrl = `${siteUrl}/${to}`;
    const filePath = join(outDir, from);
    await mkdir(dirname(filePath), { recursive: true });
    await writeFile(filePath, renderRedirectDocument(targetUrl));
    const markdownTarget = `${siteUrl}/${markdownOutput(to.split("#")[0])}`;
    await writeFile(
      join(outDir, markdownOutput(from)),
      `Moved: this page now lives at ${markdownTarget}\n`,
    );
  }
}

async function writeSiteMetadata(pages, buildDate) {
  await writeFile(join(outDir, "llms.txt"), renderLlmsTxt(pages, buildDate));
  await writeFile(join(outDir, "llms-full.txt"), renderLlmsFullTxt(pages, buildDate));
  await writeFile(
    join(outDir, "robots.txt"),
    `User-agent: *\nAllow: /\n\nSitemap: ${siteUrl}/sitemap.xml\n`,
  );
  await writeFile(
    join(outDir, "sitemap.xml"),
    `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n  <url><loc>${siteUrl}/</loc><lastmod>${buildDate}</lastmod></url>\n${pages
      .flatMap((page) => [page.output, markdownOutput(page.output)])
      .map(
        (output) => `  <url><loc>${siteUrl}/${output}</loc><lastmod>${buildDate}</lastmod></url>`,
      )
      .join("\n")}\n</urlset>\n`,
  );
}

async function build() {
  const buildDate = new Date().toISOString().slice(0, 10);
  const { version } = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
  await loadManifest();
  await copyStaticAssets();

  const loaded = await loadPages();
  sitePages = loaded;

  await writeFile(
    join(outDir, "index.html"),
    renderDocument(<HomePage buildDate={buildDate} version={version} />),
  );
  await writeSiteMetadata(loaded, buildDate);
  await writeLegacyRedirects();

  for (const page of loaded) {
    const { html, headings } = await renderMarkdown(page.body, page);
    const filePath = join(outDir, page.output);
    await mkdir(dirname(filePath), { recursive: true });
    await writeFile(
      join(outDir, markdownOutput(page.output)),
      rewriteMarkdownLinksForSite(page.body, page),
    );
    await writeFile(
      filePath,
      renderDocument(
        <DocsPage page={page} content={html} headings={headings} buildDate={buildDate} />,
      ),
    );
  }

  console.log(`Built landing page and ${loaded.length} docs pages in ${relative(root, outDir)}`);
}

await build();
