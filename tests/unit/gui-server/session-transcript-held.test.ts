import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  acquireWriterLock,
  isSessionTranscriptHeld,
  releaseWriterLock,
} from "../../../gui/server/writer-lock.js";

// A stored session's model change is written through a freshly opened
// SessionManager, so it must refuse while any live writer (a tool invoke in
// this process, or another process) holds that session's transcript.
const dirs: string[] = [];

function storedSession() {
  const dir = mkdtempSync(join(tmpdir(), "opencandle-transcript-held-"));
  dirs.push(dir);
  const file = join(dir, "session.jsonl");
  writeFileSync(file, "");
  return { getSessionFile: () => file, getSessionDir: () => dir };
}

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("isSessionTranscriptHeld", () => {
  it("is false when nobody holds the session", () => {
    expect(isSessionTranscriptHeld(storedSession())).toBe(false);
  });

  it("is true while this process holds the session, such as during a tool invoke", async () => {
    const session = storedSession();
    const scope = session.getSessionFile();
    const lock = await acquireWriterLock(scope, "gui");
    expect(lock.role).toBe("writer");

    expect(isSessionTranscriptHeld(session)).toBe(true);

    releaseWriterLock(scope);
    expect(isSessionTranscriptHeld(session)).toBe(false);
  });

  it("is true while another live process holds the session", async () => {
    const session = storedSession();
    const otherPid = process.ppid;
    await acquireWriterLock(session.getSessionFile(), "tui", {
      pid: otherPid,
      ownerId: `${otherPid}:other-process`,
    });

    expect(isSessionTranscriptHeld(session)).toBe(true);
  });

  it("ignores a lock left behind by a process that exited", async () => {
    const session = storedSession();
    const deadPid = 2_147_483_000;
    await acquireWriterLock(session.getSessionFile(), "tui", {
      pid: deadPid,
      ownerId: `${deadPid}:gone`,
      isPidAlive: () => false,
    });

    expect(isSessionTranscriptHeld(session)).toBe(false);
  });
});
