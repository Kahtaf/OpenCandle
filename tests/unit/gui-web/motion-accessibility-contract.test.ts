import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { quoteFlashClass } from "../../../gui/web/src/features/market-state/shared.jsx";

function guiSource(path: string) {
  return readFileSync(resolve("gui/web/src", path), "utf8");
}

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return /\.(?:css|js|jsx)$/.test(entry.name) ? [path] : [];
  });
}

describe("GUI motion and accessibility contract", () => {
  it("uses quick, directional enter and exit motion for overlays", () => {
    const dialog = guiSource("components/ui/dialog.jsx");
    const alertDialog = guiSource("components/ui/alert-dialog.jsx");
    const sheet = guiSource("components/ui/sheet.jsx");
    const popover = guiSource("components/ui/popover.jsx");
    const dropdown = guiSource("components/ui/dropdown-menu.jsx");

    for (const source of [dialog, alertDialog, sheet, popover, dropdown]) {
      expect(source).toContain("duration-[180ms]");
      expect(source).toContain("duration-[120ms]");
      expect(source).toContain("ease-out");
      expect(source).toContain("ease-in");
    }

    expect(dialog).toContain("slide-in-from-top-2");
    expect(dialog).toContain("slide-out-to-top-1");
    expect(sheet).toContain("slide-in-from-right");
    expect(sheet).toContain("slide-out-to-right");
    expect(popover).toContain(
      'const state = open ? "open" : closeAnimationComplete ? "dormant" : "closed"',
    );
    expect(popover).toContain("data-state={state}");
    expect(popover).toContain("data-[state=dormant]:hidden");
  });

  it("avoids catch-all and first-paint transitions while honoring reduced motion", () => {
    const sources = sourceFiles(resolve("gui/web/src"))
      .map((path) => readFileSync(path, "utf8"))
      .join("\n");
    const styles = guiSource("styles.css");

    expect(sources).not.toMatch(/transition-all|transition:\s*all/);
    expect(sources).not.toContain("animate-fade-in-once");
    expect(sources).not.toMatch(
      /transition-\[[^\]]*transform\][^"\n]*active:(?:enabled:)?scale-\[0\.96\]/,
    );
    expect(styles).toContain("@media (prefers-reduced-motion: reduce)");
    expect(styles).toContain("animation-duration: 0.001ms !important");
    expect(styles).toContain("transition-duration: 0.001ms !important");
  });

  it("cross-fades refreshed quote numbers without shifting their layout", () => {
    const className = quoteFlashClass("up");

    expect(className).toContain("number-cross-fade");
    expect(className).toContain("motion-reduce:transition-none");
    expect(guiSource("styles.css")).toContain("animation: number-cross-fade 120ms ease-out");
  });

  it("uses the shared card primitive for symbol loading surfaces", () => {
    const symbolPage = guiSource("features/symbol/SymbolPage.jsx");

    expect(symbolPage).toContain('import { Card } from "../../components/ui/card.jsx"');
    expect(symbolPage).not.toContain('className="rounded-xl border border-border bg-card p-5"');
    expect(symbolPage).not.toContain(
      'className={cn("rounded-xl border border-border bg-card p-4")}',
    );
  });
});
