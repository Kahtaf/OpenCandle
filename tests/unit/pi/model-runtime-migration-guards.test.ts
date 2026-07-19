import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("Pi model runtime migration guards", () => {
  it("passes the shared model runtime to startup setup", () => {
    const source = readFileSync(resolve("src/pi/opencandle-extension.ts"), "utf-8");
    const handlerStart = source.indexOf('pi.on("session_start"');
    const handlerEnd = source.indexOf("// One-shot welcome", handlerStart);
    const handlerSource = source.slice(handlerStart, handlerEnd);

    expect(handlerSource).toMatch(
      /coordinator\.runSetup\([\s\S]*?\{ mode: "startup" \},\s*options\?\.modelRuntime,?\s*\)/,
    );
  });

  it("does not accept dismissed Codex reviews at the merge gate", () => {
    const source = readFileSync(resolve(".github/workflows/codex-review-gate.yml"), "utf-8");

    expect(source).toContain('["COMMENTED", "APPROVED"].includes(review.state)');
    expect(source).not.toContain('review.state !== "PENDING"');
  });

  it("publishes the Codex gate result to the PR head commit", () => {
    const source = readFileSync(resolve(".github/workflows/codex-review-gate.yml"), "utf-8");

    expect(source).toContain("github.rest.repos.createCommitStatus({");
    expect(source).toContain("sha: headSha,");
    expect(source).toContain("context: statusContext,");
    expect(source).toContain('await publishStatus("success"');
  });

  it("requires a head-specific review artifact for clean Codex completion", () => {
    const source = readFileSync(resolve(".github/workflows/codex-review-gate.yml"), "utf-8");

    expect(source).toContain("github.rest.pulls.listReviews");
    expect(source).toContain("github.rest.issues.listComments");
    expect(source).toContain("Codex Review: Didn't find any major issues");
    expect(source).toContain("comment.body.includes(reviewedHeadMarker)");
    expect(source).not.toContain("listForIssueComment");
  });
});
