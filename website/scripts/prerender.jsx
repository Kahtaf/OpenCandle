import { copyFile, cp, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, normalize, posix, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Badge, Button, Card, OpenCandleLogo } from "@opencandle/ui";
import matter from "gray-matter";
import {
  Archive,
  ArrowUp,
  AudioLines,
  Bell,
  BriefcaseBusiness,
  ChevronDown,
  ChevronRight,
  CircleHelp,
  ClipboardList,
  Clock3,
  Code2,
  Copy,
  Download,
  Ellipsis,
  Folder,
  LibraryBig,
  ListChecks,
  ListPlus,
  Menu,
  MessageCircle,
  Mic,
  MoreHorizontal,
  Palette,
  PanelLeft,
  Plus,
  RotateCcw,
  Search,
  Shapes,
  Share2,
  SlidersHorizontal,
  SquarePen,
  ThumbsDown,
  ThumbsUp,
  Volume2,
} from "lucide-react";
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
const landingTitle = "OpenCandle: Financial Research That Shows Its Work";
const landingDescription =
  "OpenCandle checks live quotes, filings, options, and macro data, then shows the sources behind every result.";
const socialImage = `${siteUrl}/assets/opencandle-social-card.png`;
const socialImageAlt = "OpenCandle: Market research that shows its work";

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
  {
    source: "docs/ways-to-run.md",
    output: "docs/ways-to-run.html",
    section: "Start here",
    navLabel: "Ways to Run",
  },
  { source: "docs/getting-started.md", output: "docs/getting-started.html", section: "Start here" },
  {
    source: "docs/hosted-pwa.md",
    output: "docs/hosted-pwa.html",
    section: "Guides",
    navLabel: "Web App Quickstart",
  },
  { source: "docs/gui-quickstart.md", output: "docs/gui-quickstart.html", section: "Guides" },
  { source: "docs/tui.md", output: "docs/tui.html", section: "Guides", navLabel: "TUI Quickstart" },
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
  {
    source: "docs/how-the-web-app-works.md",
    output: "docs/how-the-web-app-works.html",
    section: "Build",
    navLabel: "How the Web App Works",
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
  { from: "docs/first-run.html", to: "docs/getting-started.html" },
  {
    from: "docs/opencandle-vs-chatgpt.html",
    to: "docs/comparisons.html#opencandle-vs-general-chatbots",
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

function enableTaskListCheckboxes() {
  return (tree) => {
    visit(tree, "element", (node) => {
      if (node.tagName !== "input" || node.properties?.type !== "checkbox") return;

      delete node.properties.disabled;
      node.properties["aria-label"] = "Mark checklist item complete";
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
    .use(enableTaskListCheckboxes)
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
      <meta property="og:image:width" content="1200" />
      <meta property="og:image:height" content="630" />
      <meta property="og:image:alt" content={socialImageAlt} />
      <meta name="twitter:card" content="summary_large_image" />
      <meta name="twitter:title" content={title} />
      <meta name="twitter:description" content={description} />
      <meta name="twitter:image" content={image} />
      <meta name="twitter:image:alt" content={socialImageAlt} />
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
  const onDocs = output.startsWith("docs/");
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
          <Button asChild variant="ghost" size="sm" className="hidden sm:inline-flex">
            <a href="https://github.com/Kahtaf/OpenCandle">GitHub</a>
          </Button>
          <Button asChild variant="ghost" size="sm" className="hidden sm:inline-flex">
            <a href="https://web.opencandle.app">Open Web App</a>
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
            Open source financial investigator.
          </p>
          <p className="mt-5 font-mono text-muted-foreground text-xs">MIT licensed</p>
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

function BrowserIcon() {
  return (
    <LucideIcon>
      <rect x="3" y="4" width="18" height="14" rx="2" />
      <path d="M8 21h8" />
      <path d="M12 18v3" />
    </LucideIcon>
  );
}

function TerminalIcon() {
  return (
    <LucideIcon>
      <path d="m4 17 6-6-6-6" />
      <path d="M12 19h8" />
    </LucideIcon>
  );
}

function CopyIcon() {
  return (
    <LucideIcon>
      <rect x="9" y="9" width="13" height="13" rx="2" />
      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
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
    <div className="surface-demo" data-surface-demo="" data-surface-active="gui">
      <div className="surface-demo-toolbar">
        <div
          className="surface-demo-tabs icon-tabs"
          role="tablist"
          aria-label="Choose an OpenCandle view"
        >
          <button
            className="icon-tab"
            id="surface-tab-gui"
            type="button"
            role="tab"
            aria-selected="true"
            aria-controls="surface-panel-gui"
            tabIndex="0"
            data-surface-tab="gui"
          >
            <BrowserIcon />
            <span>Browser</span>
          </button>
          <button
            className="icon-tab"
            id="surface-tab-tui"
            type="button"
            role="tab"
            aria-selected="false"
            aria-controls="surface-panel-tui"
            tabIndex="-1"
            data-surface-tab="tui"
          >
            <TerminalIcon />
            <span>CLI</span>
          </button>
        </div>
      </div>
      <div className="surface-demo-stage surface-demo-flipper" data-surface-flipper="">
        <div
          className="surface-demo-face surface-demo-face-gui"
          id="surface-panel-gui"
          role="tabpanel"
          aria-labelledby="surface-tab-gui"
          aria-hidden="false"
          data-surface-panel="gui"
        >
          {/* This labeled product walkthrough is intentionally silent. */}
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
          className="surface-demo-face surface-demo-face-tui"
          id="surface-panel-tui"
          role="tabpanel"
          aria-labelledby="surface-tab-tui"
          aria-hidden="true"
          data-surface-panel="tui"
          inert
        >
          {/* This labeled product walkthrough is intentionally silent. */}
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
        <aside
          className="docs-sidebar sticky top-14 hidden h-[calc(100dvh-3.5rem)] w-[260px] shrink-0 border-border border-r bg-background md:block"
          data-docs-sidebar=""
        >
          <DocsNav activeOutput={page.output} />
        </aside>
        <div className="flex min-w-0 flex-1 flex-col">{children}</div>
      </div>
      <SiteFooter output={page.output} />
      <SiteDrawer output={page.output} />
    </>
  );
}

const comparisonQuestion =
  "I own 200 shares of NVDA and I’m worried it could drop next month. Should I hold, sell some, or protect my investment?";

function ChatGptBrandIcon() {
  return (
    <svg
      aria-hidden="true"
      data-brand-icon="chatgpt"
      viewBox="146.694 227.042 267.198 266.405"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        d="M249.176 323.434V298.276C249.176 296.158 249.971 294.569 251.825 293.509L302.406 264.381C309.29 260.409 317.5 258.555 325.973 258.555C357.75 258.555 377.877 283.185 377.877 309.399C377.877 311.253 377.877 313.371 377.611 315.49L325.178 284.771C322.001 282.919 318.822 282.919 315.645 284.771L249.176 323.434ZM367.283 421.415V361.301C367.283 357.592 365.694 354.945 362.516 353.092L296.048 314.43L317.763 301.982C319.617 300.925 321.206 300.925 323.058 301.982L373.639 331.112C388.205 339.586 398.003 357.592 398.003 375.069C398.003 395.195 386.087 413.733 367.283 421.412V421.415ZM233.553 368.452L211.838 355.742C209.986 354.684 209.19 353.095 209.19 350.975V292.718C209.19 264.383 230.905 242.932 260.301 242.932C271.423 242.932 281.748 246.641 290.49 253.26L238.321 283.449C235.146 285.303 233.555 287.951 233.555 291.659V368.455L233.553 368.452ZM280.292 395.462L249.176 377.985V340.913L280.292 323.436L311.407 340.913V377.985L280.292 395.462ZM300.286 475.968C289.163 475.968 278.837 472.259 270.097 465.64L322.264 435.449C325.441 433.597 327.03 430.949 327.03 427.239V350.445L349.011 363.155C350.865 364.213 351.66 365.802 351.66 367.922V426.179C351.66 454.514 329.679 475.965 300.286 475.965V475.968ZM237.525 416.915L186.944 387.785C172.378 379.31 162.582 361.305 162.582 343.827C162.582 323.436 174.763 305.164 193.563 297.485V357.861C193.563 361.571 195.154 364.217 198.33 366.071L264.535 404.467L242.82 416.915C240.967 417.972 239.377 417.972 237.525 416.915ZM234.614 460.343C204.689 460.343 182.71 437.833 182.71 410.028C182.71 407.91 182.976 405.792 183.238 403.672L235.405 433.863C238.582 435.715 241.763 435.715 244.938 433.863L311.407 395.466V420.622C311.407 422.742 310.612 424.331 308.758 425.389L258.179 454.519C251.293 458.491 243.083 460.343 234.611 460.343H234.614ZM300.286 491.854C332.329 491.854 359.073 469.082 365.167 438.892C394.825 431.211 413.892 403.406 413.892 375.073C413.892 356.535 405.948 338.529 391.648 325.552C392.972 319.991 393.766 314.43 393.766 308.87C393.766 271.003 363.048 242.666 327.562 242.666C320.413 242.666 313.528 243.723 306.644 246.109C294.725 234.457 278.307 227.042 260.301 227.042C228.258 227.042 201.513 249.815 195.42 280.004C165.761 287.685 146.694 315.49 146.694 343.824C146.694 362.362 154.638 380.368 168.938 393.344C167.613 398.906 166.819 404.467 166.819 410.027C166.819 447.894 197.538 476.231 233.024 476.231C240.172 476.231 247.058 475.173 253.943 472.788C265.859 484.441 282.278 491.854 300.286 491.854Z"
        fill="currentColor"
      />
    </svg>
  );
}

function ClaudeBrandIcon() {
  return (
    <svg
      aria-hidden="true"
      data-brand-icon="claude"
      viewBox="0 0 24 24"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        d="m4.7144 15.9555 4.7174-2.6471.079-.2307-.079-.1275h-.2307l-.7893-.0486-2.6956-.0729-2.3375-.0971-2.2646-.1214-.5707-.1215-.5343-.7042.0546-.3522.4797-.3218.686.0608 1.5179.1032 2.2767.1578 1.6514.0972 2.4468.255h.3886l.0546-.1579-.1336-.0971-.1032-.0972L6.973 9.8356l-2.55-1.6879-1.3356-.9714-.7225-.4918-.3643-.4614-.1578-1.0078.6557-.7225.8803.0607.2246.0607.8925.686 1.9064 1.4754 2.4893 1.8336.3643.3035.1457-.1032.0182-.0728-.164-.2733-1.3539-2.4467-1.445-2.4893-.6435-1.032-.17-.6194c-.0607-.255-.1032-.4674-.1032-.7285L6.287.1335 6.6997 0l.9957.1336.419.3642.6192 1.4147 1.0018 2.2282 1.5543 3.0296.4553.8985.2429.8318.091.255h.1579v-.1457l.1275-1.706.2368-2.0947.2307-2.6957.0789-.7589.3764-.9107.7468-.4918.5828.2793.4797.686-.0668.4433-.2853 1.8517-.5586 2.9021-.3643 1.9429h.2125l.2429-.2429.9835-1.3053 1.6514-2.0643.7286-.8196.85-.9046.5464-.4311h1.0321l.759 1.1293-.34 1.1657-1.0625 1.3478-.8804 1.1414-1.2628 1.7-.7893 1.36.0729.1093.1882-.0183 2.8535-.607 1.5421-.2794 1.8396-.3157.8318.3886.091.3946-.3278.8075-1.967.4857-2.3072.4614-3.4364.8136-.0425.0304.0486.0607 1.5482.1457.6618.0364h1.621l3.0175.2247.7892.522.4736.6376-.079.4857-1.2142.6193-1.6393-.3886-3.825-.9107-1.3113-.3279h-.1822v.1093l1.0929 1.0686 2.0035 1.8092 2.5075 2.3314.1275.5768-.3218.4554-.34-.0486-2.2039-1.6575-.85-.7468-1.9246-1.621h-.1275v.17l.4432.6496 2.3436 3.5214.1214 1.0807-.17.3521-.6071.2125-.6679-.1214-1.3721-1.9246L14.38 17.959l-1.1414-1.9428-.1397.079-.674 7.2552-.3156.3703-.7286.2793-.6071-.4614-.3218-.7468.3218-1.4753.3886-1.9246.3157-1.53.2853-1.9004.17-.6314-.0121-.0425-.1397.0182-1.4328 1.9672-2.1796 2.9446-1.7243 1.8456-.4128.164-.7164-.3704.0667-.6618.4008-.5889 2.386-3.0357 1.4389-1.882.929-1.0868-.0062-.1579h-.0546l-6.3385 4.1164-1.1293.1457-.4857-.4554.0608-.7467.2307-.2429 1.9064-1.3114Z"
        fill="#d97757"
      />
    </svg>
  );
}

function MockNavItem({ icon: Icon, children, active = false }) {
  return (
    <div className={active ? "mock-nav-item mock-nav-item--active" : "mock-nav-item"}>
      <Icon aria-hidden="true" data-app-icon="" />
      <span>{children}</span>
    </div>
  );
}

function ComposerIcon({ icon: Icon, label, className = "" }) {
  return (
    <button
      className={`composer-icon-button ${className}`.trim()}
      type="button"
      aria-label={label}
      tabIndex="-1"
    >
      <Icon aria-hidden="true" />
    </button>
  );
}

function ComparisonComposer({ variant }) {
  if (variant === "chatgpt") {
    return (
      <div className="product-composer product-composer--chatgpt" data-ui-composer="">
        <ComposerIcon icon={Plus} label="Add attachment" />
        <span className="product-composer-field" data-composer-field="">
          Ask ChatGPT
        </span>
        <div className="product-composer-actions">
          <button className="composer-model-button" type="button" tabIndex="-1">
            Instant
            <ChevronDown aria-hidden="true" />
          </button>
          <ComposerIcon icon={Mic} label="Use microphone" className="composer-desktop-control" />
          <ComposerIcon
            icon={AudioLines}
            label="Start voice mode"
            className="chatgpt-voice-button"
          />
          <ComposerIcon icon={ArrowUp} label="Send message" className="chatgpt-mobile-send" />
        </div>
      </div>
    );
  }

  if (variant === "claude") {
    return (
      <div className="product-composer product-composer--claude" data-ui-composer="">
        <span className="product-composer-field" data-composer-field="">
          Write a message…
        </span>
        <div className="product-composer-footer">
          <ComposerIcon icon={Plus} label="Add attachment" />
          <div className="product-composer-actions">
            <button className="composer-model-button" type="button" tabIndex="-1">
              Opus 5 High
              <ChevronDown aria-hidden="true" />
            </button>
            <ComposerIcon icon={Mic} label="Use microphone" />
            <ComposerIcon icon={AudioLines} label="Start voice mode" />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="product-composer product-composer--opencandle" data-ui-composer="">
      <span className="product-composer-field" data-composer-field="">
        Ask anything
      </span>
      <div className="product-composer-footer">
        <button className="opencandle-model-button" type="button" tabIndex="-1">
          gpt-5.6-terra
          <ChevronDown aria-hidden="true" />
        </button>
        <ComposerIcon icon={Plus} label="Add context" />
        <ComposerIcon icon={ArrowUp} label="Send message" className="opencandle-send-button" />
      </div>
    </div>
  );
}

function ProductMobileHeader({ variant }) {
  if (variant === "opencandle") {
    return (
      <header
        className="product-mobile-header product-mobile-header--opencandle"
        data-ui-mobile-header=""
      >
        <ComposerIcon icon={Menu} label="Open sidebar" />
        <span className="product-mobile-brand">
          <OpenCandleLogo src="assets/logo.svg" />
          <strong>OpenCandle</strong>
        </span>
      </header>
    );
  }

  if (variant === "claude") {
    return (
      <header
        className="product-mobile-header product-mobile-header--claude"
        data-ui-mobile-header=""
      >
        <ComposerIcon icon={Menu} label="Open sidebar" />
        <strong>Claude</strong>
        <span className="product-mobile-actions">
          <ComposerIcon icon={Share2} label="Share chat" />
          <ComposerIcon icon={MoreHorizontal} label="More options" />
        </span>
      </header>
    );
  }

  return (
    <header
      className="product-mobile-header product-mobile-header--chatgpt"
      data-ui-mobile-header=""
    >
      <ComposerIcon icon={Menu} label="Open sidebar" />
      <strong>ChatGPT</strong>
      <span className="product-mobile-actions">
        <ComposerIcon icon={SquarePen} label="New chat" />
        <ComposerIcon icon={MoreHorizontal} label="More options" />
      </span>
    </header>
  );
}

function ChatGptComparisonUi() {
  return (
    <article
      className="answer-surface product-mock product-mock--chatgpt"
      data-answer-surface="chatgpt"
    >
      <aside className="product-sidebar chatgpt-sidebar" data-ui-sidebar="">
        <div className="chatgpt-brand">
          <span>
            <strong>ChatGPT</strong>
            <small>Pro</small>
          </span>
          <span className="product-brand-actions">
            <ComposerIcon icon={Search} label="Search chats" />
            <ComposerIcon icon={PanelLeft} label="Toggle sidebar" />
          </span>
        </div>
        <div className="mock-nav">
          <MockNavItem icon={SquarePen}>New chat</MockNavItem>
          <MockNavItem icon={LibraryBig}>Library</MockNavItem>
          <MockNavItem icon={Folder}>Projects</MockNavItem>
          <MockNavItem icon={Clock3}>Scheduled</MockNavItem>
          <MockNavItem icon={Shapes}>Plugins</MockNavItem>
          <MockNavItem icon={Ellipsis}>More</MockNavItem>
        </div>
        <div className="mock-recents">
          <strong>Recents</strong>
          <span className="mock-recent-active">NVDA Investment Strategy</span>
          <span>Apple Q2 2026 Earnings</span>
          <span>Mortgage Recast in Ontario</span>
          <span>World Cup Recap</span>
          <span>Cottage Cheese Yogurt Pancakes</span>
        </div>
        <div className="product-profile">
          <span>W</span>
          <div>
            <strong>Warren</strong>
            <small>Pro</small>
          </div>
          <Shapes aria-hidden="true" />
        </div>
      </aside>
      <div className="product-main chatgpt-main">
        <ProductMobileHeader variant="chatgpt" />
        <header className="product-topbar product-topbar--chatgpt">
          <span />
          <span>
            <Share2 aria-hidden="true" />
            Share
            <MoreHorizontal aria-hidden="true" />
          </span>
        </header>
        <div className="product-conversation chatgpt-conversation">
          <p className="product-user-message chatgpt-user-message" data-ui-user-message="">
            {comparisonQuestion}
          </p>
          <div className="product-response chatgpt-response">
            <p>
              Because your concern is only the next month, I would keep the 200 shares and hedge
              rather than sell outright.
            </p>
            <h3>Hold</h3>
            <p>Keep all the upside, but only if you can tolerate a 15–25% drawdown.</p>
            <h3>Sell some</h3>
            <p>Trim 50–100 shares if this has grown beyond roughly 15–20% of your portfolio.</p>
            <h3>Protect</h3>
            <p>
              A protective put limits downside. A collar can help pay for it, but caps your upside.
            </p>
            <p className="chatgpt-follow-up">
              Share your cost basis, account type, and downside limit, and I can suggest a current
              strike and estimate the cost.
            </p>
          </div>
        </div>
        <ComparisonComposer variant="chatgpt" />
      </div>
    </article>
  );
}

function ClaudeComparisonUi() {
  return (
    <article
      className="answer-surface product-mock product-mock--claude"
      data-answer-surface="claude"
    >
      <aside className="product-sidebar claude-sidebar" data-ui-sidebar="">
        <div className="claude-brand">
          <strong>Claude</strong>
          <span className="product-brand-actions">
            <Search aria-hidden="true" />
            <PanelLeft aria-hidden="true" />
          </span>
        </div>
        <div className="mock-nav">
          <MockNavItem icon={Plus}>New chat</MockNavItem>
          <MockNavItem icon={MessageCircle}>Chats</MockNavItem>
          <MockNavItem icon={Archive}>Projects</MockNavItem>
          <MockNavItem icon={Shapes}>Artifacts</MockNavItem>
          <MockNavItem icon={BriefcaseBusiness}>Customize</MockNavItem>
        </div>
        <div className="mock-recents claude-products">
          <small>Products</small>
          <span>
            <Code2 aria-hidden="true" /> Code
          </span>
          <span>
            <ListChecks aria-hidden="true" /> Cowork
          </span>
          <span>
            <Palette aria-hidden="true" /> Design
          </span>
        </div>
        <div className="mock-recents">
          <strong className="mock-recents-heading">
            Recents <SlidersHorizontal aria-hidden="true" />
          </strong>
          <span className="mock-recent-active">Protecting NVDA shares from potential decline</span>
          <span>Apple’s latest earnings impact</span>
          <span>Stock sparklines API naming ideas</span>
          <span>Market data provider research</span>
        </div>
        <div className="product-profile claude-profile">
          <span>W</span>
          <div>
            <strong>Warren</strong>
            <small>Max plan</small>
          </div>
          <Download aria-hidden="true" />
        </div>
      </aside>
      <div className="product-main claude-main">
        <ProductMobileHeader variant="claude" />
        <header className="product-topbar claude-topbar">
          <strong>
            Protecting NVDA shares from potential decline
            <ChevronDown aria-hidden="true" />
          </strong>
          <span>Share</span>
        </header>
        <div className="product-conversation claude-conversation">
          <p className="product-user-message claude-user-message" data-ui-user-message="">
            {comparisonQuestion}
          </p>
          <div className="claude-context">
            Weighed position sizing, tax implications, and hedging around earnings
          </div>
          <div className="product-response claude-response">
            <p>
              Worth knowing first: NVDA is around <strong>$206</strong>, and its next earnings
              report is <strong>August 26, 2026</strong>, inside the window you’re worried about.
            </p>
            <h3>If the position is too large</h3>
            <p>
              Selling 50–100 shares permanently reduces concentration risk. Account type and taxes
              can change the choice.
            </p>
            <h3>If earnings are the concern</h3>
            <p>
              200 shares is exactly 2 contracts. Consider a September put 5–10% below spot, after
              the earnings date.
            </p>
            <p className="claude-chain-note">
              The premium may be expensive. Pull up the actual chain rather than guessing.
            </p>
            <div className="claude-response-actions" aria-hidden="true">
              <Copy />
              <Volume2 />
              <ThumbsUp />
              <ThumbsDown />
              <RotateCcw />
            </div>
          </div>
        </div>
        <ComparisonComposer variant="claude" />
      </div>
    </article>
  );
}

function OpenCandleComparisonUi() {
  return (
    <article
      className="answer-surface product-mock product-mock--opencandle"
      data-answer-surface="opencandle"
    >
      <aside className="product-sidebar opencandle-sidebar" data-ui-sidebar="">
        <div className="opencandle-mock-brand">
          <OpenCandleLogo src="assets/logo.svg" />
          <strong>OpenCandle</strong>
          <PanelLeft aria-hidden="true" />
        </div>
        <div className="opencandle-new-chat">
          <Plus aria-hidden="true" />
          New chat
        </div>
        <div className="opencandle-search">
          <Search aria-hidden="true" />
          Search
        </div>
        <div className="mock-recents opencandle-market-state">
          <small>Market state</small>
          <MockNavItem icon={ListPlus}>Watchlists</MockNavItem>
          <MockNavItem icon={BriefcaseBusiness}>Portfolios</MockNavItem>
          <MockNavItem icon={Bell}>Alerts</MockNavItem>
          <MockNavItem icon={ClipboardList}>Reports</MockNavItem>
        </div>
        <div className="mock-recents opencandle-market-state">
          <small>App</small>
          <MockNavItem icon={SlidersHorizontal}>Settings</MockNavItem>
        </div>
        <div className="mock-recents opencandle-history">
          <small>Today</small>
          <span className="mock-recent-active">I own 200 shares of NVDA</span>
          <span>What changed for Apple?</span>
          <small>Yesterday</small>
          <span>What’s moving in my portfolio?</span>
        </div>
      </aside>
      <div className="product-main opencandle-main">
        <ProductMobileHeader variant="opencandle" />
        <div className="product-conversation opencandle-conversation">
          <p className="product-user-message opencandle-user-message" data-ui-user-message="">
            {comparisonQuestion}
          </p>
          <small className="opencandle-answer-label">Answer</small>
          <div className="opencandle-research-card">
            <span className="opencandle-research-icon">
              <CircleHelp aria-hidden="true" />
            </span>
            <div>
              <strong>Research &amp; analysis</strong>
              <small>9 of 9 steps · 103 sources</small>
            </div>
            <span className="opencandle-sources" data-ui-research-status="">
              <span className="opencandle-source-stack" data-ui-source-stack="">
                <img src="assets/source-icons/yahoo.svg" alt="" />
                <img src="assets/source-icons/sec.svg" alt="" />
                <img src="assets/source-icons/fred.svg" alt="" />
                <img src="assets/source-icons/reddit.svg" alt="" />
              </span>
              103 sources
            </span>
            <span className="opencandle-steps">9 steps &nbsp;›</span>
            <ChevronRight className="opencandle-research-chevron" aria-hidden="true" />
          </div>
          <div className="product-response opencandle-response">
            <p>
              <strong>At $206.84, protect the position rather than sell it outright:</strong> buy 2
              contracts, NVDA Aug. 21 $200 puts, to cover all 200 shares.
            </p>
            <table>
              <thead>
                <tr>
                  <th>Position / hedge</th>
                  <th>Current reference</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td data-label="Position">NVDA shares</td>
                  <td data-label="Reference">200 × $206.84 = $41,368</td>
                  <td data-label="Action">Hold</td>
                </tr>
                <tr>
                  <td data-label="Position">Protective puts</td>
                  <td data-label="Reference">2 × Aug. 21 $200 puts</td>
                  <td data-label="Action">Buy</td>
                </tr>
                <tr>
                  <td data-label="Position">Indicative quoted ask</td>
                  <td data-label="Reference">$5.95/share</td>
                  <td data-label="Action">~$1,190 total</td>
                </tr>
                <tr>
                  <td data-label="Position">Protection floor at expiry</td>
                  <td data-label="Reference">~$194.05/share</td>
                  <td data-label="Action">Roughly 6.2% net downside</td>
                </tr>
              </tbody>
            </table>
            <p className="opencandle-evidence">
              <strong>Why this trade:</strong> price is above its 20-day average but below its
              50-day average. RSI is neutral at 51.1, while MACD and volume are constructive. Risk
              remains elevated at 35.8% annualized volatility and a 20.2% maximum drawdown.
            </p>
            <p className="opencandle-time">
              Option quotes were after-hours as of July 24, 2026, 4:00 p.m. ET.
            </p>
          </div>
        </div>
        <ComparisonComposer variant="opencandle" />
      </div>
    </article>
  );
}

function AnswerComparisonTabs() {
  return (
    <div className="answer-tabs" data-answer-tabs="">
      <div className="icon-tabs answer-icon-tabs" role="tablist" aria-label="Compare answers">
        <button
          className="icon-tab"
          id="answer-tab-chatgpt"
          type="button"
          role="tab"
          aria-selected="true"
          aria-controls="answer-panel-chatgpt"
          tabIndex="0"
          data-answer-tab="chatgpt"
        >
          <span data-tab-icon="">
            <ChatGptBrandIcon />
          </span>
          <span>ChatGPT</span>
        </button>
        <button
          className="icon-tab"
          id="answer-tab-claude"
          type="button"
          role="tab"
          aria-selected="false"
          aria-controls="answer-panel-claude"
          tabIndex="-1"
          data-answer-tab="claude"
        >
          <span data-tab-icon="">
            <ClaudeBrandIcon />
          </span>
          <span>Claude</span>
        </button>
        <button
          className="icon-tab"
          id="answer-tab-opencandle"
          type="button"
          role="tab"
          aria-selected="false"
          aria-controls="answer-panel-opencandle"
          tabIndex="-1"
          data-answer-tab="opencandle"
        >
          <span data-tab-icon="">
            <OpenCandleLogo src="assets/logo.svg" />
          </span>
          <span>OpenCandle</span>
        </button>
      </div>
      <div className="answer-tab-panels">
        <div
          id="answer-panel-chatgpt"
          role="tabpanel"
          aria-labelledby="answer-tab-chatgpt"
          data-answer-panel="chatgpt"
        >
          <ChatGptComparisonUi />
        </div>
        <div
          id="answer-panel-claude"
          role="tabpanel"
          aria-labelledby="answer-tab-claude"
          data-answer-panel="claude"
          hidden
        >
          <ClaudeComparisonUi />
        </div>
        <div
          id="answer-panel-opencandle"
          role="tabpanel"
          aria-labelledby="answer-tab-opencandle"
          data-answer-panel="opencandle"
          hidden
        >
          <OpenCandleComparisonUi />
        </div>
      </div>
    </div>
  );
}

function HomePage({ buildDate, version }) {
  const faqs = [
    {
      question: "What is OpenCandle?",
      answer:
        "OpenCandle is an open source AI research app for stocks, portfolios, and markets. It runs in your browser at web.opencandle.app, as a local app, or in the terminal, and it checks current financial data before it answers.",
    },
    {
      question: "Is it free?",
      answer:
        "OpenCandle is free and MIT licensed, with no OpenCandle account or subscription. You pay your AI model provider for usage. Core market data does not require paid data APIs.",
    },
    {
      question: "Do I have to install anything?",
      answer:
        "No. web.opencandle.app runs the full agent in your browser. Installing locally adds SEC filings, X and Reddit sentiment, and background alert monitoring.",
    },
    {
      question: "What is the difference between the web and local versions?",
      answer:
        "The web app runs in your browser with no install. The local version adds the GUI, terminal, and local-only tools such as SEC filings, sentiment, and background alerts.",
    },
    {
      question: "How is this different from asking ChatGPT?",
      answer:
        "OpenCandle gathers quotes, filings, option chains, macro data, and portfolio context before answering. It then shows the source and timestamp behind the result, including anything it could not verify.",
    },
    {
      question: "What do I need to get started?",
      answer:
        "A model API key from OpenAI, Anthropic, or Google. You only need Node.js if you install OpenCandle locally; the web app needs nothing beyond your browser.",
    },
    {
      question: "Does OpenCandle place trades?",
      answer:
        "No. OpenCandle is read-only research software. It gathers and organizes market evidence, but it does not place trades, route orders, or provide financial advice.",
    },
    {
      question: "Where is my data stored?",
      answer:
        "On your device: in your browser for the web app and under ~/.opencandle for local installs, never on an OpenCandle server. Questions and research context are sent to the model provider you choose.",
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
  return (
    <HtmlDocument
      title={landingTitle}
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
            operatingSystem: "Web, macOS, Windows, Linux",
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
        <section className="landing-hero">
          <div className="landing-hero-copy">
            <h1>
              <span data-hero-heading-lockup="">Market research</span> that shows its work.
            </h1>
            <p>
              OpenCandle is an open source financial investigator. It fetches live quotes, filings,
              options, and macro data before answering, then shows where the result came from.
            </p>
            <div className="landing-hero-actions" data-hero-actions="">
              <div className="landing-command" data-surface-command="">
                <span aria-hidden="true">$</span>
                <code data-surface-command-text="">npx opencandle@latest gui</code>
                <button type="button" aria-label="Copy install command" data-command-copy="">
                  <CopyIcon />
                </button>
              </div>
              <Button
                asChild
                variant="bordered"
                rounded="lg"
                className="hero-try-cta !h-14 !min-h-14"
              >
                <a href="https://web.opencandle.app">Try the web app</a>
              </Button>
            </div>
            <p className="landing-hero-proof">
              Free and open source · your data stays on your device · bring your own AI
            </p>
          </div>
          <div className="landing-hero-media">
            <SurfaceDemo />
            <template data-legacy-cli-demo="">
              <LegacyCliDemo />
            </template>
          </div>
        </section>

        <section
          className="landing-evidence mx-auto max-w-[1100px] px-4 lg:px-6"
          aria-labelledby="evidence-map-title"
        >
          <div className="evidence-map">
            <div className="evidence-map-heading">
              <h2 id="evidence-map-title">The best tools behind every answer.</h2>
              <p>
                OpenCandle picks the relevant sources for the question and keeps each one attached
                to the result.
              </p>
            </div>
            <div className="evidence-hub" aria-hidden="true">
              <span className="evidence-hub-mark">
                <OpenCandleLogo src="assets/logo.svg" className="h-7 w-7" />
              </span>
            </div>
            <svg
              className="evidence-branches"
              viewBox="0 0 1000 112"
              preserveAspectRatio="none"
              aria-hidden="true"
            >
              <defs>
                <linearGradient
                  id="evidence-branch-gradient"
                  x1="500"
                  y1="0"
                  x2="500"
                  y2="112"
                  gradientUnits="userSpaceOnUse"
                >
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

        <section className="answer-comparison border-border border-y bg-secondary/50">
          <div className="mx-auto max-w-[1100px] px-4 py-20 lg:px-6">
            <div className="answer-comparison-heading">
              <h2>
                Same question.
                <span>Different results.</span>
              </h2>
              <p>
                Why not ask another AI? OpenCandle can use live financial tools before it answers,
                so you get current numbers you can inspect.
              </p>
            </div>
            <AnswerComparisonTabs />
            <p className="answer-comparison-link">
              <a
                className="font-medium text-foreground underline underline-offset-4 hover:text-muted-foreground"
                href="docs/comparisons.html"
              >
                See the full comparison
              </a>
            </p>
          </div>
        </section>

        <section className="faq-section mx-auto max-w-[1100px] px-4 lg:px-6" aria-label="FAQ">
          <div className="faq-layout">
            <div className="faq-heading">
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
            <aside
              className="docs-toc-sidebar hidden w-[200px] shrink-0 bg-background xl:block"
              data-docs-toc-sidebar=""
            >
              <div className="sticky top-14 flex flex-col gap-0.5 px-3 py-5">
                <SectionLabel>On this page</SectionLabel>
                <nav className="flex flex-col gap-0.5" aria-label="On this page">
                  {toc.map((heading) => (
                    <a
                      key={heading.id}
                      href={`#${heading.id}`}
                      className="block rounded-md px-2 py-1.5 text-muted-foreground text-sm transition-colors hover:bg-tertiary hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
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
- [Ways to run](${siteUrl}/docs/ways-to-run.html)
- [Getting started](${siteUrl}/docs/getting-started.html)

## Guides

- [Web app quickstart](${siteUrl}/docs/hosted-pwa.html)
- [GUI quickstart](${siteUrl}/docs/gui-quickstart.html)
- [TUI quickstart](${siteUrl}/docs/tui.html)
- [Investigation recipes](${siteUrl}/docs/investigation-recipes.html)

## Reference

- [Data sources](${siteUrl}/docs/data-sources.html)
- [Configuration](${siteUrl}/docs/configuration.html)

## Build

- [How the web app works](${siteUrl}/docs/how-the-web-app-works.html)
- [System architecture](${siteUrl}/docs/system-architecture.html)
- [Build a tool](${siteUrl}/docs/build-a-tool.html)
- [Testing and evals](${siteUrl}/docs/testing-and-evals.html)

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
