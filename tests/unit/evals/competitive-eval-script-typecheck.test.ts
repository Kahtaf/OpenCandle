import { join } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

// Regression guard: `tsc --noEmit` excludes tests/, so the competitive eval
// script is never type-checked by the repo typecheck. A missing import
// (`completeSimple`) only surfaced at runtime as a ReferenceError at the
// first judge call — after a live OpenCandle session had already been paid
// for. This test semantic-checks the script itself so unresolved names and
// type errors fail fast in unit tests instead of mid live run.
describe("run-competitive-finance-eval script", () => {
  it("type-checks with no diagnostics", () => {
    const scriptPath = join(process.cwd(), "tests", "scripts", "run-competitive-finance-eval.ts");
    const program = ts.createProgram([scriptPath], {
      noEmit: true,
      skipLibCheck: true,
      strict: true,
      module: ts.ModuleKind.NodeNext,
      moduleResolution: ts.ModuleResolutionKind.NodeNext,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true,
      resolveJsonModule: true,
    });
    const source = program.getSourceFile(scriptPath);
    expect(source).toBeDefined();
    const diagnostics = ts
      .getPreEmitDiagnostics(program, source)
      .map(
        (diagnostic) =>
          `TS${diagnostic.code}: ${ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n")}`,
      );
    expect(diagnostics).toEqual([]);
  }, 20_000);
});
