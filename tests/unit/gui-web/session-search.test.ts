import { describe, expect, it } from "vitest";
import { filterSessions } from "../../../gui/web/src/features/sessions/session-search.js";

describe("filterSessions", () => {
  const sessions = [
    {
      id: "one",
      name: "DRAM options",
      firstMessage: "look at MU leaps",
      allMessagesText: "Micron and DRAM 2027 calls",
    },
    {
      id: "two",
      name: "AAPL price",
      firstMessage: "what is the price of AAPL",
      allMessagesText: "AAPL quote",
    },
  ];

  it("returns all sessions for an empty query", () => {
    expect(filterSessions(sessions, "")).toEqual(sessions);
  });

  it("matches session names, first messages, and transcript text case-insensitively", () => {
    expect(filterSessions(sessions, "dram")).toEqual([sessions[0]]);
    expect(filterSessions(sessions, "price")).toEqual([sessions[1]]);
    expect(filterSessions(sessions, "2027")).toEqual([sessions[0]]);
  });
});
