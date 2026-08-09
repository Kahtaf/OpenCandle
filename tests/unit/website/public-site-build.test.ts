import { execFile } from "node:child_process";
import { readFileSync } from "node:fs";
import { access, readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { JSDOM } from "jsdom";
import { beforeAll, describe, expect, it } from "vitest";

const root = process.cwd();
const execFileAsync = promisify(execFile);

describe("public site build contract", () => {
  beforeAll(async () => {
    await execFileAsync("npm", ["run", "docs:site:build"], { cwd: root });
  }, 30_000);

  it("declares shared UI and website workspaces", () => {
    const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));

    expect(pkg.workspaces).toContain("packages/ui");
    expect(pkg.workspaces).toContain("website");
  });

  it("has a website workspace and shared UI package", async () => {
    await expect(access(join(root, "website/package.json"))).resolves.toBeUndefined();
    await expect(access(join(root, "packages/ui/package.json"))).resolves.toBeUndefined();
  });

  it("removes the old hand-written build script entirely", async () => {
    await expect(access(join(root, "website/build.mjs"))).rejects.toThrow();
  });

  it("keeps generated docs readable in raw HTML", async () => {
    const docsHtml = await readFile(join(root, "website/dist/docs/index.html"), "utf8");

    expect(docsHtml).toContain("OpenCandle Docs");
    expect(docsHtml).toContain("How OpenCandle Works");
    expect(docsHtml).toContain("Getting Started");
    expect(docsHtml).toContain("application/ld+json");
  });

  it("preserves static metadata, assets, and markdown alternates", async () => {
    for (const file of [
      "website/dist/robots.txt",
      "website/dist/sitemap.xml",
      "website/dist/llms.txt",
      "website/dist/llms-full.txt",
      "website/dist/assets/logo.svg",
      "website/dist/assets/gui-screenshot.png",
      "website/dist/assets/gui-demo.mp4",
      "website/dist/assets/tui-demo.mp4",
      "website/dist/assets/gui-demo-poster.png",
      "website/dist/assets/tui-demo-poster.png",
      "website/dist/assets/source-icons/yahoo.svg",
      "website/dist/assets/source-icons/sec.svg",
      "website/dist/assets/source-icons/fred.svg",
      "website/dist/assets/source-icons/tradingview.svg",
      "website/dist/assets/source-icons/coingecko.png",
      "website/dist/assets/source-icons/polymarket.ico",
      "website/dist/assets/source-icons/reddit.svg",
      "website/dist/assets/source-icons/exa.svg",
      "website/dist/assets/source-icons/brave.svg",
      "website/dist/assets/source-icons/alpha-vantage.ico",
      "website/dist/favicon.ico",
      "website/dist/docs/index.md",
    ]) {
      await expect(
        access(join(root, file)),
        `${file} should be generated`,
      ).resolves.toBeUndefined();
    }

    const docsHtml = await readFile(join(root, "website/dist/docs/index.html"), "utf8");
    expect(docsHtml).toContain('rel="alternate"');
    expect(docsHtml).toContain("docs/index.md");
  });

  it("publishes a readable social preview with concise landing metadata", async () => {
    const homeHtml = await readFile(join(root, "website/dist/index.html"), "utf8");
    const homeDocument = new JSDOM(homeHtml, { url: "https://opencandle.app/" }).window.document;
    const title = homeDocument.querySelector("title")?.textContent ?? "";
    const description =
      homeDocument.querySelector('meta[property="og:description"]')?.getAttribute("content") ?? "";
    const socialImage =
      homeDocument.querySelector('meta[property="og:image"]')?.getAttribute("content") ?? "";
    const socialImageAlt =
      homeDocument.querySelector('meta[property="og:image:alt"]')?.getAttribute("content") ?? "";
    const socialImageBytes = await readFile(
      join(root, "website/dist/assets/opencandle-social-card.png"),
    );

    expect(title).toBe("OpenCandle: Financial Research That Shows Its Work");
    expect(description).toBe(
      "OpenCandle checks live quotes, filings, options, and macro data, then shows the sources behind every result.",
    );
    expect(description.length).toBeLessThanOrEqual(125);
    expect(socialImage).toBe("https://opencandle.app/assets/opencandle-social-card.png");
    expect(socialImageAlt).toBe("OpenCandle: Market research that shows its work");
    expect(socialImageBytes.readUInt32BE(16)).toBe(1200);
    expect(socialImageBytes.readUInt32BE(20)).toBe(630);
  });

  it("copies docs images into the site and references them from docs pages", async () => {
    for (const image of [
      "website/dist/docs/images/gui-chat-research.png",
      "website/dist/docs/images/gui-symbol-page.png",
      "website/dist/docs/images/gui-portfolio.png",
    ]) {
      await expect(access(join(root, image)), `${image} should be copied`).resolves.toBeUndefined();
    }

    const guiQuickstartHtml = await readFile(
      join(root, "website/dist/docs/gui-quickstart.html"),
      "utf8",
    );
    expect(guiQuickstartHtml).toContain("images/gui-chat-research.png");

    const guiQuickstartMd = await readFile(
      join(root, "website/dist/docs/gui-quickstart.md"),
      "utf8",
    );
    expect(guiQuickstartMd).toContain("https://opencandle.app/docs/images/gui-chat-research.png");
  });

  it("renders GitHub-flavored Markdown features through the parser pipeline", async () => {
    const tuiHtml = await readFile(join(root, "website/dist/docs/tui.html"), "utf8");
    const buildToolHtml = await readFile(join(root, "website/dist/docs/build-a-tool.html"), "utf8");

    expect(tuiHtml).toContain("<table>");
    expect(tuiHtml).toContain("<thead>");
    expect(buildToolHtml).toContain("<pre><code");
    expect(buildToolHtml).toContain("contains-task-list");
  });

  it("keeps public output decoupled from local GUI runtime routes", async () => {
    const homeHtml = await readFile(join(root, "website/dist/index.html"), "utf8");
    const docsHtml = await readFile(join(root, "website/dist/docs/index.html"), "utf8");

    for (const output of [homeHtml, docsHtml]) {
      expect(output).not.toContain("/api/bootstrap");
      expect(output).not.toContain("/api/session/events");
      expect(output).not.toContain("WebSocket");
    }
  });

  it("keeps desktop documentation rails white while the mobile drawer stays muted", async () => {
    const docsHtml = await readFile(join(root, "website/dist/docs/index.html"), "utf8");
    const docsDocument = new JSDOM(docsHtml, {
      url: "https://opencandle.app/docs/index.html",
    }).window.document;
    const sidebar = docsDocument.querySelector("aside[data-docs-sidebar]");
    const tocSidebar = docsDocument.querySelector("aside[data-docs-toc-sidebar]");
    const mobileDrawer = docsDocument.querySelector("[data-drawer-panel]");

    expect(sidebar).not.toBeNull();
    expect(sidebar?.classList.contains("docs-sidebar")).toBe(true);
    expect(sidebar?.classList.contains("bg-background")).toBe(true);
    expect(sidebar?.classList.contains("bg-secondary")).toBe(false);
    expect(sidebar?.classList.contains("overflow-hidden")).toBe(false);
    expect(sidebar?.querySelector('nav[aria-label="Documentation"]')).not.toBeNull();
    expect(tocSidebar?.classList.contains("bg-background")).toBe(true);
    expect(mobileDrawer?.classList.contains("bg-secondary")).toBe(true);
  });

  it("extends the desktop table of contents surface to the viewport edge", async () => {
    const docsHtml = await readFile(join(root, "website/dist/docs/index.html"), "utf8");
    const docsDocument = new JSDOM(docsHtml, {
      url: "https://opencandle.app/docs/index.html",
    }).window.document;
    const sidebar = docsDocument.querySelector("aside[data-docs-toc-sidebar]");
    const nav = sidebar?.querySelector('nav[aria-label="On this page"]');
    const firstLink = nav?.querySelector("a");

    expect(sidebar).not.toBeNull();
    expect(sidebar?.classList.contains("docs-toc-sidebar")).toBe(true);
    expect(nav).not.toBeNull();
    expect(nav?.parentElement?.classList.contains("px-3")).toBe(true);
    expect(nav?.parentElement?.classList.contains("py-5")).toBe(true);
    expect(firstLink?.classList.contains("hover:bg-tertiary")).toBe(true);
    expect(firstLink?.classList.contains("hover:bg-secondary")).toBe(false);
  });

  it("presents the GUI as primary and the TUI as equally complete across the docs journey", async () => {
    const overviewHtml = await readFile(join(root, "website/dist/docs/index.html"), "utf8");
    const gettingStartedHtml = await readFile(
      join(root, "website/dist/docs/getting-started.html"),
      "utf8",
    );
    const firstRunHtml = await readFile(join(root, "website/dist/docs/first-run.html"), "utf8");
    const tuiHtml = await readFile(join(root, "website/dist/docs/tui.html"), "utf8");

    expect(overviewHtml).toContain(
      "runs three ways: the web app at web.opencandle.app, the local GUI, and the terminal (TUI)",
    );
    expect(gettingStartedHtml).toContain("The local GUI is its primary interface");
    expect(gettingStartedHtml).not.toContain("The CLI is the primary entry point");
    expect(gettingStartedHtml.indexOf("opencandle gui")).toBeLessThan(
      gettingStartedHtml.indexOf("# terminal (TUI)"),
    );
    expect(firstRunHtml).toContain("docs/getting-started.html");
    expect(firstRunHtml).toContain("noindex");
    expect(tuiHtml).toContain("equally complete terminal interface");
    expect(tuiHtml).not.toContain("main OpenCandle agent experience");
  });

  it("does not keep the old decorative landing-page shell in generated output", async () => {
    const homeHtml = await readFile(join(root, "website/dist/index.html"), "utf8");
    const homeDocument = new JSDOM(homeHtml, { url: "https://opencandle.app/" }).window.document;

    expect(homeHtml).not.toContain("hero-grid");
    expect(homeHtml).not.toContain("float-tile");
    expect(homeDocument.querySelector(".landing-hero h1")?.textContent).toBe(
      "Market research that shows its work.",
    );
    expect(
      homeDocument.querySelector(".landing-hero h1 [data-hero-heading-lockup]")?.textContent,
    ).toBe("Market research");
    expect(homeHtml).not.toContain("Ask any market question.");
    expect(homeHtml).not.toContain("Check every number.");
  });

  it("puts the install command and the free/local proof line in the hero", async () => {
    const homeHtml = await readFile(join(root, "website/dist/index.html"), "utf8");
    const homeDocument = new JSDOM(homeHtml, { url: "https://opencandle.app/" }).window.document;
    const hero = homeDocument.querySelector(".landing-hero");
    const heroCommand = homeDocument.querySelector(".landing-hero [data-surface-command]");

    // The one-line install is the fastest path to value, so it must appear
    // above the product demo rather than only in the closing CTA.
    expect(homeHtml.indexOf("npx opencandle@latest gui")).toBeLessThan(
      homeHtml.indexOf('data-surface-demo=""'),
    );
    expect(hero?.textContent).toContain(
      "OpenCandle is an open source financial investigator. It fetches live quotes, filings, options, and macro data before answering, then shows where the result came from.",
    );
    expect(hero?.textContent).toContain(
      "Free and open source · your data stays on your device · bring your own AI",
    );
    expect(hero?.textContent).not.toContain("core market data needs no key");
    expect(hero?.textContent).not.toContain("no account");
    expect(homeHtml).not.toContain("local-first financial research workspace");
    expect(homeHtml).not.toContain("Start in the visual GUI");
    expect(heroCommand?.querySelector("code")?.textContent).toBe("npx opencandle@latest gui");
    expect(heroCommand?.querySelector("[data-command-copy]")).not.toBeNull();
    expect(homeHtml).not.toContain("Start with the GUI");
    expect(homeHtml).not.toContain("Prefer the terminal");
    expect(homeDocument.querySelector("header a[href='docs/comparisons.html']")).toBeNull();
    expect(homeDocument.querySelector(".evidence-hub-label")).toBeNull();
  });

  it("renders the homepage product journey and switchable product demos", async () => {
    const homeHtml = await readFile(join(root, "website/dist/index.html"), "utf8");

    expect(homeHtml).toContain("The best tools behind every answer.");
    expect(homeHtml).toContain(
      "OpenCandle picks the relevant sources for the question and keeps each one attached to the result.",
    );
    expect(homeHtml).not.toContain("Ask. Gather. Verify.");
    expect(homeHtml).toContain("Same question.");
    expect(homeHtml).toContain("Different results.");
    expect(homeHtml).toContain(
      "Why not ask another AI? OpenCandle can use live financial tools before it answers, so you get current numbers you can inspect.",
    );
    expect(homeHtml).toContain('aria-label="OpenCandle terminal demonstration"');
    expect(homeHtml).toContain('data-cli-demo=""');
    expect(homeHtml).toContain('data-surface-demo=""');
    expect(homeHtml).toContain('role="tablist"');
    expect(homeHtml).toContain('data-surface-tab="tui"');
    expect(homeHtml).toContain('data-surface-tab="gui"');
    expect(homeHtml).toContain('data-surface-video="tui"');
    expect(homeHtml).toContain('data-surface-video="gui"');
    expect(homeHtml.match(/controls=""/g)).toHaveLength(2);
    expect(homeHtml).toContain('data-legacy-cli-demo=""');
    expect(homeHtml).toContain("It runs in your browser at web.opencandle.app");
    expect(homeHtml.indexOf('data-surface-tab="gui"')).toBeLessThan(
      homeHtml.indexOf('data-surface-tab="tui"'),
    );
    expect(homeHtml).toMatch(/data-surface-tab="gui"[^>]*>[\s\S]*?Browser/);
    expect(homeHtml).toMatch(/data-surface-tab="tui"[^>]*>[\s\S]*?CLI/);
    expect(homeHtml).toContain('class="surface-demo-tabs icon-tabs"');
    expect(homeHtml).toContain('class="icon-tabs answer-icon-tabs"');
    expect(homeHtml).not.toContain("Research from the terminal or the browser");
    expect(homeHtml).toContain('class="evidence-branches"');
    expect(homeHtml).toContain("evidence-branch--mobile");
    expect(homeHtml).toContain("evidence-row-connector--desktop");
    expect(homeHtml).toContain("evidence-row-connector--mobile");
    expect(homeHtml).toContain('class="evidence-source-logo"');
    expect(homeHtml).toContain('src="assets/source-icons/fred.svg"');
    expect(homeHtml).not.toMatch(/<img[^>]+src="https?:\/\//);
    expect(homeHtml).not.toContain("evidence-source-mark");
    expect(homeHtml).not.toContain("Exa + Brave");
    expect(homeHtml).toContain(">Exa</strong>");
    expect(homeHtml).toContain(">Brave</strong>");
    expect(homeHtml).not.toContain("autoplay");
    expect(homeHtml).toContain("npx opencandle@latest gui");
    expect(homeHtml).toContain("Common questions");
  });

  it("uses the same full footer on the homepage and docs pages", async () => {
    const homeHtml = await readFile(join(root, "website/dist/index.html"), "utf8");
    const docsHtml = await readFile(join(root, "website/dist/docs/index.html"), "utf8");
    const homeDocument = new JSDOM(homeHtml, { url: "https://opencandle.app/" }).window.document;
    const docsDocument = new JSDOM(docsHtml, {
      url: "https://opencandle.app/docs/index.html",
    }).window.document;
    const homeFooter = homeDocument.querySelector(".site-footer");
    const docsFooter = docsDocument.querySelector(".site-footer");

    expect(homeFooter?.textContent.replace(/\s+/g, " ").trim()).toBe(
      docsFooter?.textContent.replace(/\s+/g, " ").trim(),
    );
    expect(homeDocument.querySelector(".site-footer-minimal")).toBeNull();
    expect(homeFooter?.textContent).toContain("Product");
    expect(homeFooter?.textContent).toContain("Build");
    expect(homeFooter?.textContent).toContain("Project");
    expect(homeFooter?.textContent).toContain("Open source financial investigator.");
    expect(homeFooter?.textContent).not.toContain("Local-first financial research");
  });

  it("renders both product videos as accessible sides of the hero switcher", async () => {
    const homeHtml = await readFile(join(root, "website/dist/index.html"), "utf8");
    const homeDocument = new JSDOM(homeHtml, { url: "https://opencandle.app/" }).window.document;
    const demo = homeDocument.querySelector<HTMLElement>("[data-surface-demo]");
    const flipper = demo?.querySelector("[data-surface-flipper]");
    const browserPanel = flipper?.querySelector<HTMLElement>('[data-surface-panel="gui"]');
    const cliPanel = flipper?.querySelector<HTMLElement>('[data-surface-panel="tui"]');

    expect(demo?.dataset.surfaceActive).toBe("gui");
    expect(flipper).not.toBeNull();
    expect(flipper?.classList.contains("surface-demo-stage")).toBe(true);
    expect(browserPanel?.getAttribute("aria-hidden")).toBe("false");
    expect(browserPanel?.hasAttribute("inert")).toBe(false);
    expect(cliPanel?.getAttribute("aria-hidden")).toBe("true");
    expect(cliPanel?.hasAttribute("inert")).toBe(true);
    expect(browserPanel?.hidden).toBe(false);
    expect(cliPanel?.hidden).toBe(false);
  });

  it("keeps the expanded hero demo within the available desktop viewport gutter", async () => {
    const siteCss = await readFile(join(root, "website/src/site.css"), "utf8");
    const desktopHeroRule = siteCss.match(
      /@media \(min-width: 60rem\)[\s\S]*?\.landing-hero-media\s*\{([\s\S]*?)\}/,
    )?.[1];
    const normalizedRule = desktopHeroRule
      ?.replace(/\s+/g, " ")
      .replace(/\(\s+/g, "(")
      .replace(/\s+\)/g, ")")
      .trim();

    expect(normalizedRule).toContain(
      "width: min(calc(100% + min(7vw, 6rem)), calc(100% + max(1.5rem, (100vw - 1320px) / 2 + 1.5rem)))",
    );
    expect(normalizedRule).not.toContain("width: calc(100% + min(7vw, 6rem))");
  });

  it("keeps the desktop hero heading clear of the product demo", async () => {
    const siteCss = await readFile(join(root, "website/src/site.css"), "utf8");
    const heroHeadingRule = siteCss.match(/\.landing-hero-copy h1\s*\{([\s\S]*?)\}/)?.[1];
    const desktopHeroRule = siteCss.match(
      /@media \(min-width: 60rem\)[\s\S]*?\.landing-hero\s*\{([\s\S]*?)\}/,
    )?.[1];
    const desktopHeroMediaRule = siteCss.match(
      /@media \(min-width: 60rem\)[\s\S]*?\.landing-hero-media\s*\{([\s\S]*?)\}/,
    )?.[1];

    expect(heroHeadingRule?.replace(/\s+/g, " ")).toContain("font-size: clamp(2.75rem, 4vw, 4rem)");
    expect(desktopHeroRule?.replace(/\s+/g, " ")).toContain(
      "grid-template-columns: minmax(460px, 0.75fr) minmax(0, 1.25fr)",
    );
    expect(desktopHeroRule?.replace(/\s+/g, " ")).toContain("gap: clamp(4rem, 6vw, 6rem)");
    expect(desktopHeroMediaRule?.replace(/\s+/g, " ")).toContain("transform: translateX(-2rem)");
  });

  it("answers first-run and privacy questions without implementation jargon", async () => {
    const homeHtml = await readFile(join(root, "website/dist/index.html"), "utf8");
    const homeDocument = new JSDOM(homeHtml, { url: "https://opencandle.app/" }).window.document;
    const faq = homeDocument.querySelector('[aria-label="FAQ"]');

    expect(faq?.textContent).toContain("What do I need to get started?");
    expect(faq?.textContent).toContain("Node.js");
    expect(faq?.textContent).toContain("Do I have to install anything?");
    expect(faq?.textContent).toContain("web.opencandle.app runs the full agent in your browser");
    expect(faq?.textContent).toContain("Where is my data stored?");
    expect(faq?.textContent).toContain(
      "in your browser for the web app and under ~/.opencandle for local installs",
    );
    expect(faq?.textContent).toContain("never on an OpenCandle server");
    expect(faq?.textContent).toContain(
      "Questions and research context are sent to the model provider you choose.",
    );
    expect(faq?.textContent).not.toContain("bundled Pi agent runtime");
    expect(faq?.textContent).not.toContain("typed finance tools");
    expect(faq?.textContent).not.toContain("Which data sources does OpenCandle use?");
  });

  it("keeps the homepage focused on product evidence instead of decorative filler", async () => {
    const homeHtml = await readFile(join(root, "website/dist/index.html"), "utf8");
    const homeDocument = new JSDOM(homeHtml, { url: "https://opencandle.app/" }).window.document;
    const guiTab = homeDocument.querySelector("#surface-tab-gui");
    const hero = homeDocument.querySelector(".landing-hero");
    const evidenceMap = homeDocument.querySelector(".evidence-map");
    const comparison = homeDocument.querySelector(".answer-comparison");
    const faq = homeDocument.querySelector('[aria-label="FAQ"]');

    expect(homeHtml).not.toContain(">Local-first<");
    expect(homeHtml).not.toContain("One engine. Two complete interfaces.");
    expect(homeHtml).not.toContain("Start visually in the GUI.");
    expect(homeHtml).not.toContain("Typed tools · live providers");
    expect(homeHtml).not.toContain("How it works");
    expect(homeHtml).not.toContain("One local workspace");
    expect(homeHtml).not.toContain("One command. Your machine.");
    expect(homeHtml).not.toContain('class="landing-eyebrow"');
    expect(guiTab?.querySelector(".surface-demo-tab-icon")).toBeNull();
    expect(guiTab?.firstElementChild?.tagName).toBe("svg");
    expect(homeHtml).toContain("Same question.");
    expect(homeHtml).toContain("Different results.");
    expect(homeHtml).toContain('data-answer-surface="chatgpt"');
    expect(homeHtml).toContain('data-answer-surface="claude"');
    expect(homeHtml).toContain('data-answer-surface="opencandle"');
    expect(homeHtml).not.toContain("Why not just ask a chatbot?");
    expect(homeHtml).not.toContain("Research in the browser or the terminal");
    expect(homeHtml).not.toContain("twitterSentimentTool");
    expect(hero?.querySelector("[data-surface-command]")).not.toBeNull();
    expect(hero?.querySelector("[data-surface-demo]")).not.toBeNull();
    expect(evidenceMap).not.toBeNull();
    expect(comparison).not.toBeNull();
    expect(faq).not.toBeNull();
    expect(homeHtml).not.toContain("Ask. Gather. Verify.");
    expect(homeHtml).not.toContain('class="research-steps"');
    expect(homeHtml).not.toContain('class="builder-section');
    expect(homeHtml).not.toContain('class="extension-path"');
    expect(homeHtml).not.toContain('aria-label="Start locally"');
    expect(homeHtml).not.toContain("See the first run");
    expect(homeHtml).not.toContain("MIT licensed · Node.js");
    expect(homeHtml).not.toContain("MIT licensed · read-only");
    expect(homeHtml.indexOf('class="landing-hero')).toBeLessThan(
      homeHtml.indexOf('class="evidence-map"'),
    );
    expect(homeHtml.indexOf('class="evidence-map"')).toBeLessThan(
      homeHtml.indexOf('class="answer-comparison'),
    );
    expect(homeHtml.indexOf('class="answer-comparison')).toBeLessThan(
      homeHtml.indexOf('aria-label="FAQ"'),
    );
  });

  it("compares the same NVDA question with progressively more concrete answers", async () => {
    const homeHtml = await readFile(join(root, "website/dist/index.html"), "utf8");
    const homeDocument = new JSDOM(homeHtml, { url: "https://opencandle.app/" }).window.document;
    const comparison = homeDocument.querySelector(".answer-comparison");
    const tablist = comparison?.querySelector('[role="tablist"]');
    const tabs = [...(tablist?.querySelectorAll('[role="tab"]') ?? [])];
    const panels = [...(comparison?.querySelectorAll('[role="tabpanel"]') ?? [])];
    const chatgpt = comparison?.querySelector('[data-answer-surface="chatgpt"]');
    const claude = comparison?.querySelector('[data-answer-surface="claude"]');
    const opencandle = comparison?.querySelector('[data-answer-surface="opencandle"]');

    expect(tablist?.getAttribute("aria-label")).toBe("Compare answers");
    expect(tabs).toHaveLength(3);
    expect(tabs.every((tab) => tab.querySelector("svg, [data-tab-icon]"))).toBe(true);
    expect(tabs[0]?.querySelector('[data-brand-icon="chatgpt"]')).not.toBeNull();
    expect(tabs[1]?.querySelector('[data-brand-icon="claude"]')).not.toBeNull();
    expect(tabs[2]?.querySelector('img[src="assets/logo.svg"]')).not.toBeNull();
    expect(tabs.every((tab) => !tab.hasAttribute("data-featured"))).toBe(true);
    expect(tabs[0]?.textContent).not.toContain("✣");
    expect(tabs[1]?.textContent).not.toContain("✳");
    expect(tabs[0]?.getAttribute("aria-selected")).toBe("true");
    expect(panels).toHaveLength(3);
    expect(panels[0]?.hasAttribute("hidden")).toBe(false);
    expect(panels[1]?.hasAttribute("hidden")).toBe(true);
    expect(panels[2]?.hasAttribute("hidden")).toBe(true);
    const surfaces = [chatgpt, claude, opencandle];
    for (const surface of surfaces) {
      expect(surface?.querySelector("[data-ui-sidebar]")).not.toBeNull();
      expect(surface?.querySelector("[data-ui-composer]")).not.toBeNull();
      expect(surface?.querySelector("[data-ui-user-message]")?.textContent).toContain(
        "I own 200 shares of NVDA",
      );
    }
    expect(comparison?.querySelector(".comparison-prompt")).toBeNull();
    expect(chatgpt?.textContent).toContain("15–25% drawdown");
    expect(chatgpt?.textContent).toContain("Trim 50–100 shares");
    expect(chatgpt?.textContent).toContain("cost basis, account type, and downside limit");
    expect(chatgpt?.textContent).not.toContain("$200 put");
    expect(claude?.textContent).toContain("August 26, 2026");
    expect(claude?.textContent).toContain("200 shares is exactly 2 contracts");
    expect(claude?.textContent).toContain("September put 5–10% below spot");
    expect(claude?.textContent).toContain("actual chain rather than guessing");
    expect(claude?.textContent).not.toContain("$1,190");
    expect(chatgpt?.querySelector(".product-profile strong")?.textContent).toBe("Warren");
    expect(claude?.querySelector(".product-profile strong")?.textContent).toBe("Warren");
    expect(comparison?.textContent).not.toMatch(/kahtaf/i);
    expect(opencandle?.querySelector("[data-ui-research-status]")?.textContent).toContain(
      "103 sources",
    );
    expect(opencandle?.textContent).toContain("2 contracts");
    expect(opencandle?.textContent).toContain("Aug. 21");
    expect(opencandle?.textContent).toContain("$200 put");
    expect(opencandle?.textContent).toContain("$1,190");
    expect(opencandle?.textContent).toContain("$194.05");
    expect(opencandle?.textContent).toContain("RSI is neutral at 51.1");
    expect(opencandle?.textContent).toContain("35.8% annualized volatility");
    expect(opencandle?.textContent).toContain("20.2% maximum drawdown");
    expect(opencandle?.textContent).toContain("July 24, 2026, 4:00 p.m. ET");
    expect(opencandle?.querySelector(".opencandle-latest-pill")).toBeNull();
  });

  it("recreates each app with vector controls, its native composer, and a mobile shell", async () => {
    const homeHtml = await readFile(join(root, "website/dist/index.html"), "utf8");
    const siteCss = await readFile(join(root, "website/src/site.css"), "utf8");
    const homeDocument = new JSDOM(homeHtml, { url: "https://opencandle.app/" }).window.document;
    const comparison = homeDocument.querySelector(".answer-comparison");

    for (const product of ["chatgpt", "claude", "opencandle"]) {
      const surface = comparison?.querySelector(`[data-answer-surface="${product}"]`);
      const navItems = [...(surface?.querySelectorAll(".mock-nav-item") ?? [])];
      const composer = surface?.querySelector("[data-ui-composer]");

      expect(surface?.querySelector("[data-ui-mobile-header]")).not.toBeNull();
      expect(navItems.length).toBeGreaterThan(0);
      expect(navItems.every((item) => item.querySelector("svg[data-app-icon]"))).toBe(true);
      expect(composer?.querySelector("[data-composer-field]")).not.toBeNull();
      expect(composer?.querySelectorAll("svg").length).toBeGreaterThanOrEqual(2);
    }

    expect(
      comparison?.querySelector('[data-answer-surface="chatgpt"] [data-ui-composer]')?.textContent,
    ).toContain("Instant");
    expect(
      comparison?.querySelector('[data-answer-surface="claude"] [data-ui-composer]')?.textContent,
    ).toContain("Opus 5 High");
    expect(
      comparison?.querySelector('[data-answer-surface="opencandle"] [data-ui-composer]')
        ?.textContent,
    ).toContain("gpt-5.6-terra");
    expect(
      comparison?.querySelectorAll('[data-answer-surface="opencandle"] [data-ui-source-stack] img'),
    ).toHaveLength(4);
    expect(comparison?.textContent).not.toMatch(/[□▥▱◷♧▣☷⌕▤]/);
    expect(siteCss).toMatch(/\.answer-surface \.product-mobile-header\s*\{\s*display:\s*none;/);
  });

  it("publishes the web launch docs pages with navigation labels", async () => {
    for (const file of [
      "website/dist/docs/ways-to-run.html",
      "website/dist/docs/ways-to-run.md",
      "website/dist/docs/how-the-web-app-works.html",
      "website/dist/docs/how-the-web-app-works.md",
    ]) {
      await expect(
        access(join(root, file)),
        `${file} should be generated`,
      ).resolves.toBeUndefined();
    }

    const docsHtml = await readFile(join(root, "website/dist/docs/index.html"), "utf8");
    const docsDocument = new JSDOM(docsHtml, {
      url: "https://opencandle.app/docs/index.html",
    }).window.document;
    const sidebarNav = docsDocument.querySelector('nav[aria-label="Documentation"]');

    expect(sidebarNav?.textContent).toContain("Ways to Run");
    expect(sidebarNav?.textContent).toContain("Web App Quickstart");
    expect(sidebarNav?.textContent).toContain("How the Web App Works");
    expect(sidebarNav?.textContent).toContain("TUI Quickstart");

    const sectionForLink = (label: string) => {
      const link = [...(sidebarNav?.querySelectorAll("a") ?? [])].find(
        (item) => item.textContent?.trim() === label,
      );
      return link?.parentElement?.querySelector("p")?.textContent?.trim();
    };

    expect(sectionForLink("Web App Quickstart")).toBe("Guides");
    expect(sectionForLink("GUI Quickstart")).toBe("Guides");
    expect(sectionForLink("TUI Quickstart")).toBe("Guides");
    expect(sectionForLink("How the Web App Works")).toBe("Build");

    const buildLinks = [...(sidebarNav?.querySelectorAll("div") ?? [])]
      .find((group) => group.querySelector("p")?.textContent?.trim() === "Build")
      ?.querySelectorAll("a");
    expect(
      [...((buildLinks as NodeListOf<HTMLAnchorElement> | undefined) ?? [])].map((link) =>
        link.textContent?.trim(),
      ),
    ).toEqual([
      "System Architecture",
      "How the Web App Works",
      "Build a Tool",
      "Testing and Evals",
    ]);

    const waysToRunHtml = await readFile(join(root, "website/dist/docs/ways-to-run.html"), "utf8");
    expect(waysToRunHtml).toContain("<table>");

    const llmsTxt = await readFile(join(root, "website/dist/llms.txt"), "utf8");
    expect(llmsTxt).toContain("https://opencandle.app/docs/ways-to-run.html");
    expect(llmsTxt).toContain("https://opencandle.app/docs/hosted-pwa.html");
    expect(llmsTxt).toContain("https://opencandle.app/docs/how-the-web-app-works.html");
  });

  it("offers the hosted web app from the homepage hero", async () => {
    const homeHtml = await readFile(join(root, "website/dist/index.html"), "utf8");
    const homeDocument = new JSDOM(homeHtml, { url: "https://opencandle.app/" }).window.document;
    const hero = homeDocument.querySelector(".landing-hero");
    const heroActions = hero?.querySelector("[data-hero-actions]");
    const heroWebAppLink = heroActions?.querySelector('a[href="https://web.opencandle.app"]');
    const actionChildren = [...(heroActions?.children ?? [])];
    const siteCss = await readFile(join(root, "website/src/site.css"), "utf8");

    expect(heroActions).not.toBeNull();
    expect(actionChildren[0]?.hasAttribute("data-surface-command")).toBe(true);
    expect(actionChildren[1]).toBe(heroWebAppLink);
    expect(heroWebAppLink).not.toBeNull();
    expect(heroWebAppLink?.textContent?.trim()).toBe("Try the web app");
    expect(heroWebAppLink?.classList.contains("hero-try-cta")).toBe(true);
    expect(heroWebAppLink?.classList.contains("!h-14")).toBe(true);
    expect(heroWebAppLink?.classList.contains("rounded-lg")).toBe(true);
    expect(heroActions?.querySelector("[data-surface-command]")?.textContent).toContain(
      "npx opencandle@latest gui",
    );
    expect(siteCss).toMatch(
      /\.landing-hero-actions\s*\{[\s\S]*?width:\s*min\(100%, 460px\)[\s\S]*?grid-template-columns:\s*minmax\(0, 1fr\)/,
    );
    expect(siteCss).toMatch(/\.landing-hero-actions \.landing-command\s*\{[\s\S]*?width:\s*100%/);
    expect(siteCss).toMatch(
      /\.landing-hero-actions \.hero-try-cta\s*\{[\s\S]*?width:\s*100%[\s\S]*?\n\s*height:\s*56px/,
    );
  });

  it("explains the web and local versions in the homepage FAQ", async () => {
    const homeHtml = await readFile(join(root, "website/dist/index.html"), "utf8");
    const homeDocument = new JSDOM(homeHtml, { url: "https://opencandle.app/" }).window.document;
    const faq = [...homeDocument.querySelectorAll(".faq-list details")].find((item) =>
      item.textContent?.includes("What is the difference between the web and local versions?"),
    );

    expect(faq).toBeDefined();
    expect(faq?.textContent).toContain("The web app runs in your browser with no install.");
    expect(faq?.textContent).toContain(
      "The local version adds the GUI, terminal, and local-only tools",
    );
  });

  it("keeps the comparisons guide focused on general chatbots", async () => {
    const comparisons = await readFile(join(root, "docs/comparisons.md"), "utf8");

    expect(comparisons).toContain("## OpenCandle vs General Chatbots");
    expect(comparisons).not.toContain("Finance Websites");
    expect(comparisons).not.toContain("Spreadsheets");
    expect(comparisons).not.toContain("Custom Scripts");
  });

  it("folds the public relay explanation into the web app guide", async () => {
    const websiteBuilder = await readFile(join(root, "website/scripts/prerender.jsx"), "utf8");
    const webAppGuide = await readFile(join(root, "docs/how-the-web-app-works.md"), "utf8");

    expect(websiteBuilder).not.toContain('source: "docs/provider-relay.md"');
    expect(webAppGuide).toContain("## The relay, and why it exists");
    expect(webAppGuide).toContain("The relay is deliberately narrow");
    expect(webAppGuide).not.toContain("Provider relay operations");
    await expect(access(join(root, "docs/provider-relay.md"))).rejects.toThrow();
  });

  it("renders the build-a-tool checklist as usable checkboxes", async () => {
    const buildToolHtml = await readFile(join(root, "website/dist/docs/build-a-tool.html"), "utf8");
    const siteCss = await readFile(join(root, "website/src/site.css"), "utf8");
    const document = new JSDOM(buildToolHtml, {
      url: "https://opencandle.app/docs/build-a-tool.html",
    }).window.document;
    const checkboxes = [
      ...document.querySelectorAll(".docs-content .task-list-item input[type='checkbox']"),
    ];

    expect(checkboxes.length).toBeGreaterThan(0);
    expect(checkboxes.every((checkbox) => !checkbox.disabled)).toBe(true);
    expect(checkboxes.every((checkbox) => checkbox.hasAttribute("aria-label"))).toBe(true);
    expect(siteCss).toMatch(
      /\.docs-content li\.task-list-item input\[type="checkbox"\]\s*\{[\s\S]*?appearance:\s*auto/,
    );
  });

  it("uses direct punctuation instead of em dashes across the public site", async () => {
    const docsFiles = (await readdir(join(root, "website/dist/docs")))
      .filter((file) => file.endsWith(".html") || file.endsWith(".md"))
      .map((file) => join(root, "website/dist/docs", file));
    const publicTextFiles = [
      join(root, "website/dist/index.html"),
      join(root, "website/dist/llms.txt"),
      join(root, "website/dist/llms-full.txt"),
      ...docsFiles,
    ];

    for (const file of publicTextFiles) {
      const contents = await readFile(file, "utf8");
      expect(contents, `${file} should not contain an em dash`).not.toContain("—");
    }
  });

  it("switches product demos with arrow keys without scrolling the page", async () => {
    const manifest = JSON.parse(
      await readFile(join(root, "website/dist/.vite/manifest.json"), "utf8"),
    );
    const entryClient = await readFile(
      join(root, "website/dist", manifest["src/entry-client.jsx"].file),
      "utf8",
    );
    const dom = new JSDOM(
      `<!doctype html>
      <html>
        <body>
          <div data-surface-command>
            <code data-surface-command-text>npx opencandle@latest gui</code>
            <button data-command-copy>Copy</button>
          </div>
          <div data-surface-demo data-surface-active="gui">
            <div role="tablist">
              <button data-surface-tab="gui" aria-selected="true" tabindex="0">Browser</button>
              <button data-surface-tab="tui" aria-selected="false" tabindex="-1">Terminal</button>
            </div>
            <div data-surface-flipper>
              <div data-surface-panel="gui" aria-hidden="false">
                <video data-surface-video="gui" src="gui.mp4"></video>
              </div>
              <div data-surface-panel="tui" aria-hidden="true" inert>
                <video data-surface-video="tui" data-src="tui.mp4"></video>
              </div>
            </div>
          </div>
        </body>
      </html>`,
      { runScripts: "outside-only", url: "https://opencandle.app/" },
    );

    Object.defineProperty(dom.window, "matchMedia", {
      configurable: true,
      value: () => ({
        matches: false,
        addEventListener() {},
      }),
    });
    Object.defineProperties(dom.window.HTMLMediaElement.prototype, {
      load: { configurable: true, value() {} },
      pause: { configurable: true, value() {} },
      play: { configurable: true, value: () => Promise.resolve() },
    });
    let copiedCommand = "";
    Object.defineProperty(dom.window.navigator, "clipboard", {
      configurable: true,
      value: {
        writeText(value: string) {
          copiedCommand = value;
          return Promise.resolve();
        },
      },
    });

    dom.window.eval(entryClient);
    const browserTab = dom.window.document.querySelector<HTMLButtonElement>(
      '[data-surface-tab="gui"]',
    );
    const terminalTab = dom.window.document.querySelector<HTMLButtonElement>(
      '[data-surface-tab="tui"]',
    );
    const event = new dom.window.KeyboardEvent("keydown", {
      bubbles: true,
      cancelable: true,
      key: "ArrowRight",
    });

    browserTab?.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(true);
    expect(terminalTab?.getAttribute("aria-selected")).toBe("true");
    expect(dom.window.document.activeElement).toBe(terminalTab);
    expect(
      dom.window.document.querySelector<HTMLElement>("[data-surface-demo]")?.dataset.surfaceActive,
    ).toBe("tui");
    expect(
      dom.window.document
        .querySelector<HTMLElement>('[data-surface-panel="gui"]')
        ?.getAttribute("aria-hidden"),
    ).toBe("true");
    expect(
      dom.window.document
        .querySelector<HTMLElement>('[data-surface-panel="tui"]')
        ?.getAttribute("aria-hidden"),
    ).toBe("false");
    expect(
      dom.window.document
        .querySelector<HTMLElement>('[data-surface-panel="gui"]')
        ?.hasAttribute("inert"),
    ).toBe(true);
    expect(
      dom.window.document
        .querySelector<HTMLElement>('[data-surface-panel="tui"]')
        ?.hasAttribute("inert"),
    ).toBe(false);
    expect(dom.window.document.querySelector("[data-surface-command-text]")?.textContent).toBe(
      "npx opencandle@latest",
    );

    dom.window.document
      .querySelector<HTMLButtonElement>("[data-command-copy]")
      ?.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
    await Promise.resolve();

    expect(copiedCommand).toBe("npx opencandle@latest");
  });

  it("shows one comparison chat at a time with keyboard-accessible icon tabs", async () => {
    const manifest = JSON.parse(
      await readFile(join(root, "website/dist/.vite/manifest.json"), "utf8"),
    );
    const entryClient = await readFile(
      join(root, "website/dist", manifest["src/entry-client.jsx"].file),
      "utf8",
    );
    const dom = new JSDOM(
      `<!doctype html>
      <html>
        <body>
          <div data-answer-tabs>
            <div role="tablist">
              <button data-answer-tab="chatgpt" aria-selected="true" tabindex="0">ChatGPT</button>
              <button data-answer-tab="claude" aria-selected="false" tabindex="-1">Claude</button>
              <button data-answer-tab="opencandle" aria-selected="false" tabindex="-1">OpenCandle</button>
            </div>
            <div data-answer-panel="chatgpt">ChatGPT answer</div>
            <div data-answer-panel="claude" hidden>Claude answer</div>
            <div data-answer-panel="opencandle" hidden>OpenCandle answer</div>
          </div>
        </body>
      </html>`,
      { runScripts: "outside-only", url: "https://opencandle.app/" },
    );

    dom.window.eval(entryClient);
    const chatgptTab = dom.window.document.querySelector<HTMLButtonElement>(
      '[data-answer-tab="chatgpt"]',
    );
    const claudeTab = dom.window.document.querySelector<HTMLButtonElement>(
      '[data-answer-tab="claude"]',
    );
    const opencandleTab = dom.window.document.querySelector<HTMLButtonElement>(
      '[data-answer-tab="opencandle"]',
    );
    const event = new dom.window.KeyboardEvent("keydown", {
      bubbles: true,
      cancelable: true,
      key: "ArrowRight",
    });

    chatgptTab?.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(true);
    expect(claudeTab?.getAttribute("aria-selected")).toBe("true");
    expect(dom.window.document.activeElement).toBe(claudeTab);
    expect(
      dom.window.document.querySelector<HTMLElement>('[data-answer-panel="chatgpt"]')?.hidden,
    ).toBe(true);
    expect(
      dom.window.document.querySelector<HTMLElement>('[data-answer-panel="claude"]')?.hidden,
    ).toBe(false);

    opencandleTab?.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));

    expect(opencandleTab?.getAttribute("aria-selected")).toBe("true");
    expect(
      dom.window.document.querySelector<HTMLElement>('[data-answer-panel="opencandle"]')?.hidden,
    ).toBe(false);
  });
});
