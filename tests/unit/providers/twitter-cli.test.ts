import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ExternalToolError,
  ExternalToolNotInstalled,
} from "../../../src/providers/external-tool-error.js";
import {
  resetTwitterCliCommandRunnerForTests,
  searchTweets,
  setTwitterCliCommandRunnerForTests,
} from "../../../src/providers/twitter-cli.js";
import envelope from "../../fixtures/twitter-cli/search-aapl.json";

describe("twitter-cli provider wrapper", () => {
  afterEach(() => {
    resetTwitterCliCommandRunnerForTests();
  });

  it("spawns twitter search and adapts envelope tweets", async () => {
    const runner = vi.fn().mockResolvedValue({
      code: 0,
      stdout: JSON.stringify(envelope),
      stderr: "",
    });
    setTwitterCliCommandRunnerForTests(runner);

    const tweets = await searchTweets("$AAPL", 20);

    expect(runner).toHaveBeenCalledWith("twitter", [
      "search",
      "$AAPL",
      "--max",
      "20",
      "-t",
      "Latest",
      "--json",
    ]);
    expect(tweets[0]).toMatchObject({
      id: "1234567890",
      author: "trader_joe",
      likes: 150,
      retweets: 45,
      replies: 12,
      views: 5000,
    });
    expect(tweets[1]).toMatchObject({
      author: "bear_market_bob",
      likes: 500,
      retweets: 120,
    });
  });

  it("adapts nested metrics from twitter-cli JSON", async () => {
    setTwitterCliCommandRunnerForTests(
      vi.fn().mockResolvedValue({
        code: 0,
        stdout: JSON.stringify({
          ok: true,
          schema_version: "1",
          data: [
            {
              id: "nested-metrics",
              text: "$AAPL breakout watch",
              username: "metrics_trader",
              metrics: { likes: 21, retweets: 5, replies: 3, views: 900 },
            },
          ],
        }),
        stderr: "",
      }),
    );

    const tweets = await searchTweets("$AAPL", 20);

    expect(tweets[0]).toMatchObject({
      likes: 21,
      retweets: 5,
      replies: 3,
      views: 900,
    });
  });

  it("throws typed not-installed error on ENOENT", async () => {
    const runner = vi.fn().mockImplementation(() => {
      const err = new Error("spawn twitter ENOENT") as NodeJS.ErrnoException;
      err.code = "ENOENT";
      throw err;
    });
    setTwitterCliCommandRunnerForTests(runner);

    await expect(searchTweets("$AAPL", 20)).rejects.toBeInstanceOf(ExternalToolNotInstalled);
    await expect(searchTweets("$AAPL", 20)).rejects.toMatchObject({
      toolName: "twitter-cli",
      installCmd: "uv tool install twitter-cli",
    });
  });

  it("redacts cookie-looking stderr before surfacing errors", async () => {
    setTwitterCliCommandRunnerForTests(
      vi.fn().mockResolvedValue({
        code: 1,
        stdout: "",
        stderr:
          "auth_token=secret123 ct0=secret456 twid=u%3D123 kdt=secret789 guest_id=v1%3Aabc No Twitter cookies found",
      }),
    );

    await expect(searchTweets("$AAPL", 20)).rejects.toThrow(
      "auth_token=[redacted] ct0=[redacted] twid=[redacted] kdt=[redacted] guest_id=[redacted] No Twitter cookies found",
    );
  });

  it("redacts full Cookie headers before surfacing errors", async () => {
    setTwitterCliCommandRunnerForTests(
      vi.fn().mockResolvedValue({
        code: 1,
        stdout: "",
        stderr:
          "Cookie: auth_token=secret123; ct0=secret456; twid=u%3D123; kdt=secret789\n401 unauthorized",
      }),
    );

    await expect(searchTweets("$AAPL", 20)).rejects.toThrow("Cookie: [redacted]\n401 unauthorized");
    await expect(searchTweets("$AAPL", 20)).rejects.not.toThrow("secret123");
  });

  it("throws ExternalToolError for malformed JSON", async () => {
    setTwitterCliCommandRunnerForTests(
      vi.fn().mockResolvedValue({ code: 0, stdout: "<html>nope</html>", stderr: "" }),
    );

    await expect(searchTweets("$AAPL", 20)).rejects.toBeInstanceOf(ExternalToolError);
    await expect(searchTweets("$AAPL", 20)).rejects.toThrow("non-JSON");
  });

  it("throws ExternalToolError for an unsuccessful envelope", async () => {
    setTwitterCliCommandRunnerForTests(
      vi.fn().mockResolvedValue({
        code: 0,
        stdout: JSON.stringify({
          ok: false,
          schema_version: "1",
          data: [],
          error: { code: "unauthorized", message: "401 unauthorized" },
        }),
        stderr: "",
      }),
    );

    await expect(searchTweets("$AAPL", 20)).rejects.toMatchObject({
      code: "unauthorized",
      message: "401 unauthorized",
    });
  });

  it("preserves structured JSON error envelopes from non-zero exits", async () => {
    setTwitterCliCommandRunnerForTests(
      vi.fn().mockResolvedValue({
        code: 1,
        stdout: JSON.stringify({
          ok: false,
          schema_version: "1",
          error: { code: "not_authenticated", message: "No Twitter cookies found" },
        }),
        stderr: "",
      }),
    );

    await expect(searchTweets("$AAPL", 20)).rejects.toMatchObject({
      code: "not_authenticated",
      message: "No Twitter cookies found",
    });
  });
});
