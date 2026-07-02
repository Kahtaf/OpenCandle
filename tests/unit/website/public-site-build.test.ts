import { readFileSync } from "node:fs";
import { access, readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();

describe("public site build contract", () => {
  it("declares shared UI and website workspaces", () => {
    const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));

    expect(pkg.workspaces).toContain("packages/ui");
    expect(pkg.workspaces).toContain("website");
  });

  it("has a website workspace and shared UI package", async () => {
    await expect(access(join(root, "website/package.json"))).resolves.toBeUndefined();
    await expect(access(join(root, "packages/ui/package.json"))).resolves.toBeUndefined();
  });

  it("removes the old hand-written markdown renderer helpers", async () => {
    const buildSource = await readFile(join(root, "website/build.mjs"), "utf8");

    expect(buildSource).not.toContain("function stripFrontmatter");
    expect(buildSource).not.toContain("function inlineMarkdown");
    expect(buildSource).not.toContain("function renderTable");
    expect(buildSource).not.toContain("function renderMarkdown");
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

  it("copies docs images into the site and references them from docs pages", async () => {
    await expect(
      access(join(root, "website/dist/docs/images/gui-workbench.png")),
    ).resolves.toBeUndefined();

    const guiQuickstartHtml = await readFile(
      join(root, "website/dist/docs/gui-quickstart.html"),
      "utf8",
    );
    expect(guiQuickstartHtml).toContain("images/gui-workbench.png");

    const guiQuickstartMd = await readFile(
      join(root, "website/dist/docs/gui-quickstart.md"),
      "utf8",
    );
    expect(guiQuickstartMd).toContain("https://opencandle.app/docs/images/gui-workbench.png");
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

  it("does not keep the old decorative landing-page shell in generated output", async () => {
    const homeHtml = await readFile(join(root, "website/dist/index.html"), "utf8");

    expect(homeHtml).not.toContain("hero-grid");
    expect(homeHtml).not.toContain("float-tile");
    expect(homeHtml).toContain("Market research that shows its evidence");
  });
});
