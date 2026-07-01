import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const sharedUiRoot = join(root, "packages/ui/src");
const forbiddenImportPatterns = [
  "gui/web/src/hooks",
  "gui/web/src/features",
  "gui/web/src/components/ui/use-toast",
  "gui/web/src/components/ui/toast",
  "gui/web/src/components/ui/toaster",
  "/api/bootstrap",
  "/api/session/events",
];

function walk(dir: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) {
      files.push(...walk(path));
    } else if (/\.(js|jsx|css)$/.test(path)) {
      files.push(path);
    }
  }
  return files;
}

describe("shared UI package boundary", () => {
  it("does not import GUI runtime modules or local runtime endpoints", () => {
    const files = walk(sharedUiRoot);

    expect(files.length).toBeGreaterThan(0);
    for (const file of files) {
      const source = readFileSync(file, "utf8");
      for (const forbidden of forbiddenImportPatterns) {
        expect(source, `${file} must not reference ${forbidden}`).not.toContain(forbidden);
      }
    }
  });
});
