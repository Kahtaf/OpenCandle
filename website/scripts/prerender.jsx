import { copyFile, cp, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, normalize, posix, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Badge, Button, Card, Kbd, OpenCandleLogo } from "@opencandle/ui";
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
  "OpenCandle is an open source financial investigator that gathers quotes, filings, macro data, options, sentiment, and portfolio context in a local CLI or GUI.";
const socialImage = `${siteUrl}/assets/gui-screenshot.png`;

const sourcePages = [
  { source: "docs/index.md", output: "docs/index.html", section: "Docs" },
  { source: "docs/getting-started.md", output: "docs/getting-started.html", section: "Use" },
  { source: "docs/first-run.md", output: "docs/first-run.html", section: "Use" },
  { source: "docs/tui.md", output: "docs/tui.html", section: "Use" },
  {
    source: "docs/investigation-recipes.md",
    output: "docs/investigation-recipes.html",
    section: "Use",
  },
  { source: "docs/data-sources.md", output: "docs/data-sources.html", section: "Use" },
  { source: "docs/configuration.md", output: "docs/configuration.html", section: "Use" },
  { source: "docs/gui-quickstart.md", output: "docs/gui-quickstart.html", section: "Use" },
  {
    source: "docs/system-architecture.md",
    output: "docs/system-architecture.html",
    section: "Build",
  },
  { source: "docs/build-a-tool.md", output: "docs/build-a-tool.html", section: "Build" },
  { source: "docs/testing-and-evals.md", output: "docs/testing-and-evals.html", section: "Build" },
  { source: "docs/benchmarking.md", output: "docs/benchmarking.html", section: "Build" },
  { source: "docs/comparisons.md", output: "docs/comparisons.html", section: "Compare" },
  {
    source: "docs/opencandle-vs-chatgpt.md",
    output: "docs/opencandle-vs-chatgpt.html",
    section: "Compare",
  },
  {
    source: "docs/opencandle-vs-spreadsheets.md",
    output: "docs/opencandle-vs-spreadsheets.html",
    section: "Compare",
  },
  { source: "CONTRIBUTING.md", output: "docs/contributing.html", section: "Project" },
  { source: "SECURITY.md", output: "docs/security.html", section: "Project" },
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

function SiteHeader({ output = "index.html" }) {
  const prefix = rootPrefix(output);
  return (
    <header className="sticky top-0 z-20 border-border border-b bg-background/95 backdrop-blur">
      <div className="mx-auto flex h-14 max-w-[1320px] items-center justify-between gap-3 px-4 lg:px-6">
        <a className="flex items-center gap-2 font-semibold text-sm" href={`${prefix}index.html`}>
          <OpenCandleLogo src={`${prefix}assets/logo.svg`} className="h-5 w-5" />
          <span>OpenCandle</span>
        </a>
        <nav className="flex items-center gap-1 text-sm" aria-label="Primary navigation">
          <Button asChild variant="ghost" size="sm" className="hidden sm:inline-flex">
            <a href={`${prefix}index.html`}>Home</a>
          </Button>
          <Button asChild variant="ghost" size="sm">
            <a href={`${prefix}docs/index.html`}>Docs</a>
          </Button>
          <Button asChild variant="ghost" size="sm" className="hidden sm:inline-flex">
            <a href="https://github.com/Kahtaf/OpenCandle">GitHub</a>
          </Button>
          <Button asChild variant="brand" size="sm">
            <a href={`${prefix}docs/getting-started.html`}>Install</a>
          </Button>
        </nav>
      </div>
    </header>
  );
}

function NavGroups({ activeOutput }) {
  const groups = new Map();
  for (const page of sitePages) {
    if (!groups.has(page.section)) groups.set(page.section, []);
    groups.get(page.section).push(page);
  }

  return [...groups.entries()].map(([section, items]) => (
    <div key={section} className="space-y-1">
      <p className="px-2 pb-1 font-medium text-[0.68rem] text-muted-foreground uppercase">
        {section}
      </p>
      {items.map((page) => (
        <a
          key={page.output}
          href={relativeHref(page.output, activeOutput)}
          aria-current={page.output === activeOutput ? "page" : undefined}
          className="block rounded-md px-2 py-1.5 text-muted-foreground text-sm hover:bg-secondary hover:text-foreground aria-[current=page]:bg-secondary aria-[current=page]:text-foreground"
        >
          {page.title}
        </a>
      ))}
    </div>
  ));
}

function HomePage({ buildDate, version }) {
  const faqs = [
    {
      question: "What is OpenCandle?",
      answer:
        "OpenCandle is an open source financial investigator that runs as a terminal agent and local browser GUI for evidence-first market research.",
    },
    {
      question: "How is this different from asking ChatGPT?",
      answer:
        "A general chatbot answers from training data unless you wire up browsing and data feeds yourself. OpenCandle calls typed finance tools first — quotes, filings, options chains, macro series, sentiment — and keeps the provider trail, timestamps, and data gaps visible in the answer.",
    },
    {
      question: "Which model does it use?",
      answer:
        "You bring your own model credentials — Anthropic, OpenAI, or Google — through the bundled Pi runtime. Market data is separate: Yahoo Finance, SEC EDGAR, FRED, and CoinGecko work without any data-provider keys.",
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
      <main className="mx-auto max-w-[1320px] px-4 py-5 lg:px-6">
        <section className="min-h-[calc(100vh-96px)] rounded-lg border border-border bg-card shadow-subtle-xs">
          <div className="border-border border-b px-4 py-3">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h1 className="font-semibold text-2xl text-foreground">
                  Market research that shows its evidence
                </h1>
                <p className="mt-1 max-w-2xl text-muted-foreground text-sm">
                  OpenCandle is an open source financial investigator: a local terminal agent and
                  browser GUI that gathers real market data before the model writes a word.
                </p>
              </div>
              <div className="hidden items-center gap-2 sm:flex">
                <Badge variant="outline">Local-first</Badge>
                <Badge variant="outline">
                  <a href="https://github.com/Kahtaf/OpenCandle/blob/main/CHANGELOG.md">
                    v{version}
                  </a>
                </Badge>
              </div>
            </div>
          </div>
          <div className="grid gap-4 p-4 lg:grid-cols-[minmax(0,1fr)_300px]">
            <div className="space-y-4">
              <Card className="p-4">
                <p className="text-muted-foreground text-xs uppercase">Prompt</p>
                <p className="mt-2 font-medium text-lg">
                  Analyze NVDA with filings, options, sentiment, and macro context.
                </p>
                <p className="mt-4 text-muted-foreground text-xs uppercase">
                  What the answer is built from
                </p>
                <ul className="mt-2 space-y-1.5 text-sm">
                  {[
                    ["Quote and price history", "Yahoo Finance, with source and timestamp"],
                    ["Latest 10-Q and 8-K filings", "SEC EDGAR"],
                    ["Option chain with computed Greeks", "Yahoo Finance + local math"],
                    ["Rates and inflation backdrop", "FRED, series named in the answer"],
                    ["Reddit and news sentiment", "or a visible note when a source is unavailable"],
                  ].map(([evidence, source]) => (
                    <li key={evidence} className="flex flex-wrap gap-x-2">
                      <span className="font-medium">{evidence}</span>
                      <span className="text-muted-foreground">— {source}</span>
                    </li>
                  ))}
                </ul>
                <p className="mt-3 border-border border-t pt-3 text-muted-foreground text-sm">
                  The synthesis names its sources, flags stale or missing data, and separates facts
                  from judgment — so you can check the trail instead of trusting the prose.
                </p>
              </Card>
              <div className="grid gap-3 md:grid-cols-3">
                {[
                  ["Tool-first", "Calls typed finance tools before model synthesis."],
                  ["Inspectable", "Keeps provider timestamps, gaps, and evidence visible."],
                  ["Local", "Runs on your device with local session and portfolio state."],
                ].map(([title, copy]) => (
                  <Card key={title} className="p-4">
                    <h2 className="font-semibold text-base">{title}</h2>
                    <p className="mt-2 text-muted-foreground text-sm">{copy}</p>
                  </Card>
                ))}
              </div>
              <Card className="overflow-hidden">
                <img
                  src="assets/gui-screenshot.png"
                  alt="OpenCandle local GUI showing an evidence-backed market research response"
                  width="1440"
                  height="1000"
                  className="block w-full"
                  fetchPriority="high"
                />
              </Card>
            </div>
            <aside className="space-y-3">
              <Card className="p-4">
                <h2 className="font-semibold text-base">Start locally</h2>
                <div className="mt-3 space-y-2 font-mono text-sm">
                  <div className="rounded-md bg-secondary px-3 py-2">npx opencandle@latest</div>
                  <div className="rounded-md bg-secondary px-3 py-2">npx opencandle@latest gui</div>
                </div>
                <p className="mt-3 text-muted-foreground text-sm">
                  Bring your own model key — Anthropic, OpenAI, or Google. Quotes, filings, macro,
                  and crypto data work with no data-provider keys.
                </p>
                <p className="mt-2 text-muted-foreground text-xs">
                  MIT licensed · Node.js 22+ · macOS, Windows, Linux
                </p>
                <div className="mt-4 flex gap-2">
                  <Button asChild variant="brand" size="sm">
                    <a href="docs/getting-started.html">Install</a>
                  </Button>
                  <Button asChild variant="bordered" size="sm">
                    <a href="docs/index.html">Docs</a>
                  </Button>
                </div>
              </Card>
              <Card className="p-4">
                <h2 className="font-semibold text-base">Evidence trail</h2>
                <ol className="mt-3 space-y-3 text-sm">
                  {[
                    "Classify request",
                    "Call finance providers",
                    "Normalize evidence",
                    "Synthesize with caveats",
                  ].map((item, index) => (
                    <li key={item} className="flex gap-2">
                      <Kbd>{index + 1}</Kbd>
                      <span>{item}</span>
                    </li>
                  ))}
                </ol>
              </Card>
              <Card className="p-4">
                <h2 className="font-semibold text-base">FAQ</h2>
                <div className="mt-3 space-y-3">
                  {faqs.map((faq) => (
                    <details
                      key={faq.question}
                      className="rounded-md border border-border p-3 text-sm"
                    >
                      <summary className="cursor-pointer font-medium">{faq.question}</summary>
                      <p className="mt-2 text-muted-foreground">{faq.answer}</p>
                    </details>
                  ))}
                </div>
              </Card>
            </aside>
          </div>
        </section>
      </main>
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
      <SiteHeader output={page.output} />
      <main className="mx-auto grid max-w-[1320px] gap-4 px-4 py-4 lg:grid-cols-[260px_minmax(0,1fr)_230px] lg:px-6">
        <aside className="hidden lg:block">
          <div className="sticky top-[72px] space-y-4 rounded-lg border border-border bg-card p-3 shadow-subtle-xs">
            <NavGroups activeOutput={page.output} />
          </div>
        </aside>
        <section className="min-w-0">
          <details className="mb-3 rounded-lg border border-border bg-card p-3 shadow-subtle-xs lg:hidden">
            <summary className="cursor-pointer font-medium text-sm">Docs navigation</summary>
            <nav className="mt-3 space-y-4" aria-label="Documentation">
              <NavGroups activeOutput={page.output} />
            </nav>
          </details>
          <article className="rounded-lg border border-border bg-card p-4 shadow-subtle-xs sm:p-6">
            <p className="mb-4 text-muted-foreground text-xs">
              Last updated <time dateTime={buildDate}>{buildDate}</time>
            </p>
            <div
              className="docs-content"
              // biome-ignore lint/security/noDangerouslySetInnerHtml: Markdown is trusted repo-local content rendered during the static build.
              dangerouslySetInnerHTML={{ __html: content }}
            />
          </article>
        </section>
        <aside className="hidden xl:block">
          <div className="sticky top-[72px] rounded-lg border border-border bg-card p-3 shadow-subtle-xs">
            <p className="px-2 pb-2 font-medium text-[0.68rem] text-muted-foreground uppercase">
              On this page
            </p>
            <nav className="space-y-1" aria-label="On this page">
              {toc.length > 0 ? (
                toc.map((heading) => (
                  <a
                    key={heading.id}
                    href={`#${heading.id}`}
                    className="block rounded-md px-2 py-1.5 text-muted-foreground text-sm hover:bg-secondary hover:text-foreground"
                  >
                    {heading.text}
                  </a>
                ))
              ) : (
                <span className="px-2 text-muted-foreground text-sm">No sections</span>
              )}
            </nav>
          </div>
        </aside>
      </main>
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
  await copyFile(join(root, "website/assets/favicon.ico"), join(outDir, "favicon.ico"));
  await copyFile(join(root, "AGENTS.md"), join(outDir, "AGENTS.md"));
}

function renderLlmsTxt(pages, buildDate) {
  return `# OpenCandle

> Open source financial research agent for quotes, fundamentals, macro data, filings, options, sentiment, and portfolio workflows.

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
