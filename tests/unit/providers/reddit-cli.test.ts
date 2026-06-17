import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ExternalToolError,
  ExternalToolNotInstalled,
} from "../../../src/providers/external-tool-error.js";
import {
  listSubredditPosts,
  readRedditPost,
  resetRdtCommandRunnerForTests,
  searchRedditPosts,
  setRdtCommandRunnerForTests,
} from "../../../src/providers/reddit-cli.js";
import readEnvelope from "../../fixtures/rdt-cli/read-1u1jsys.json";
import searchEnvelope from "../../fixtures/rdt-cli/search-spcx.json";
import subEnvelope from "../../fixtures/rdt-cli/sub-stocks.json";

describe("rdt-cli provider wrapper", () => {
  afterEach(() => {
    resetRdtCommandRunnerForTests();
  });

  it("spawns rdt search with subreddit scope and adapts posts", async () => {
    const runner = vi.fn().mockResolvedValue({
      code: 0,
      stdout: JSON.stringify(searchEnvelope),
      stderr: "",
    });
    setRdtCommandRunnerForTests(runner);

    const posts = await searchRedditPosts("SPCX", { subreddit: "stocks", limit: 5 });

    expect(runner).toHaveBeenCalledWith("rdt", [
      "search",
      "SPCX",
      "--subreddit",
      "stocks",
      "--json",
      "--compact",
      "-n",
      "5",
    ]);
    expect(posts[0]).toMatchObject({
      id: "1u1jsys",
      subreddit: "stocks",
      author: "orbital_trader",
      comments: 14,
      score: 212,
    });
  });

  it("spawns rdt sub for subreddit browsing", async () => {
    const runner = vi.fn().mockResolvedValue({
      code: 0,
      stdout: JSON.stringify(subEnvelope),
      stderr: "",
    });
    setRdtCommandRunnerForTests(runner);

    const posts = await listSubredditPosts("stocks", { limit: 10 });

    expect(runner).toHaveBeenCalledWith("rdt", [
      "sub",
      "stocks",
      "--json",
      "--compact",
      "-n",
      "10",
    ]);
    expect(posts[0]?.id).toBe("abc123");
  });

  it("maps rdt read listing comments and ignores more records", async () => {
    const runner = vi.fn().mockResolvedValue({
      code: 0,
      stdout: JSON.stringify(readEnvelope),
      stderr: "",
    });
    setRdtCommandRunnerForTests(runner);

    const result = await readRedditPost("1u1jsys", { limit: 5 });

    expect(runner).toHaveBeenCalledWith("rdt", ["read", "1u1jsys", "--json", "-n", "5"]);
    expect(result.post.id).toBe("1u1jsys");
    expect(result.comments).toHaveLength(2);
    expect(result.comments[0]).toMatchObject({
      id: "c1",
      author: "launch_bull",
      score: 41,
    });
  });

  it("throws typed not-installed error on ENOENT", async () => {
    setRdtCommandRunnerForTests(
      vi.fn().mockImplementation(() => {
        const err = new Error("spawn rdt ENOENT") as NodeJS.ErrnoException;
        err.code = "ENOENT";
        throw err;
      }),
    );

    await expect(searchRedditPosts("SPCX", { limit: 5 })).rejects.toBeInstanceOf(
      ExternalToolNotInstalled,
    );
    await expect(searchRedditPosts("SPCX", { limit: 5 })).rejects.toMatchObject({
      toolName: "rdt",
      installCmd: "uv tool install rdt-cli",
    });
  });

  it("redacts cookie and credential paths before surfacing errors", async () => {
    setRdtCommandRunnerForTests(
      vi.fn().mockResolvedValue({
        code: 1,
        stdout: "",
        stderr:
          "reddit_session=secret123 /Users/me/.config/rdt-cli/credential.json No Reddit cookies found",
      }),
    );

    await expect(searchRedditPosts("SPCX", { limit: 5 })).rejects.toThrow(
      "reddit_session=[redacted] [redacted-credential-path] No Reddit cookies found",
    );
  });

  it("throws ExternalToolError for malformed JSON and unsuccessful envelopes", async () => {
    setRdtCommandRunnerForTests(
      vi.fn().mockResolvedValue({ code: 0, stdout: "<html>nope</html>", stderr: "" }),
    );
    await expect(searchRedditPosts("SPCX", { limit: 5 })).rejects.toBeInstanceOf(ExternalToolError);
    await expect(searchRedditPosts("SPCX", { limit: 5 })).rejects.toThrow("non-JSON");

    setRdtCommandRunnerForTests(
      vi.fn().mockResolvedValue({
        code: 0,
        stdout: JSON.stringify({
          ok: false,
          schema_version: "1",
          error: { code: "not_authenticated", message: "No Reddit cookies found" },
        }),
        stderr: "",
      }),
    );
    await expect(searchRedditPosts("SPCX", { limit: 5 })).rejects.toMatchObject({
      code: "not_authenticated",
      message: "No Reddit cookies found",
    });
  });

  it("preserves structured JSON error envelopes from non-zero exits", async () => {
    setRdtCommandRunnerForTests(
      vi.fn().mockResolvedValue({
        code: 1,
        stdout: JSON.stringify({
          ok: false,
          schema_version: "1",
          error: { code: "not_authenticated", message: "No Reddit cookies found" },
        }),
        stderr: "",
      }),
    );

    await expect(searchRedditPosts("SPCX", { limit: 5 })).rejects.toMatchObject({
      code: "not_authenticated",
      message: "No Reddit cookies found",
    });
  });
});
