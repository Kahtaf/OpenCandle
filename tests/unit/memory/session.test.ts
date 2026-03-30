import { describe, it, expect } from "vitest";
import { createSession, endSession } from "../../../src/memory/session.js";

describe("createSession", () => {
  it("generates a unique session ID", () => {
    const s1 = createSession();
    const s2 = createSession();
    expect(s1.id).toBeTruthy();
    expect(s2.id).toBeTruthy();
    expect(s1.id).not.toBe(s2.id);
  });

  it("records start time as ISO string", () => {
    const session = createSession();
    expect(session.startedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("records current working directory", () => {
    const session = createSession();
    expect(session.cwd).toBe(process.cwd());
  });

  it("has no end time initially", () => {
    const session = createSession();
    expect(session.endedAt).toBeUndefined();
  });
});

describe("endSession", () => {
  it("sets endedAt timestamp", () => {
    const session = createSession();
    const ended = endSession(session);
    expect(ended.endedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("preserves other fields", () => {
    const session = createSession();
    const ended = endSession(session);
    expect(ended.id).toBe(session.id);
    expect(ended.startedAt).toBe(session.startedAt);
    expect(ended.cwd).toBe(session.cwd);
  });
});
