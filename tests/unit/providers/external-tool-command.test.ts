import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  getExternalToolCommandCandidates,
  runExternalToolCommand,
} from "../../../src/providers/external-tool-command.js";

describe("external tool command runner", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("includes uv's default user shim directory for bare commands", () => {
    const candidates = getExternalToolCommandCandidates("twitter", {
      env: {},
      homeDir: "/Users/alex",
      platform: "darwin",
    });

    expect(candidates).toContain("twitter");
    expect(candidates).toContain("/Users/alex/.local/bin/twitter");
  });

  it("falls back to a uv tool bin directory when the command is not on PATH", async () => {
    const dir = mkdtempSync(join(tmpdir(), "opencandle-external-tool-"));
    const bin = join(dir, "twitter");
    writeFileSync(bin, "#!/bin/sh\nprintf 'uv shim ok\\n'\n");
    chmodSync(bin, 0o755);
    vi.stubEnv("PATH", tmpdir());
    vi.stubEnv("UV_TOOL_BIN_DIR", dir);

    const result = await runExternalToolCommand("twitter", ["--version"], { timeoutMs: 1000 });

    expect(result).toMatchObject({ code: 0, stdout: "uv shim ok\n", stderr: "" });

    rmSync(dir, { recursive: true, force: true });
  });

  it("discovers uv's configured tool bin directory when the shim is outside default paths", async () => {
    const root = mkdtempSync(join(tmpdir(), "opencandle-uv-tool-dir-"));
    const uvBin = join(root, "uv-bin");
    const toolBin = join(root, "tool-bin");
    mkdirSync(uvBin);
    mkdirSync(toolBin);
    writeFileSync(
      join(uvBin, "uv"),
      `#!/bin/sh\nif [ "$1" = "tool" ] && [ "$2" = "dir" ] && [ "$3" = "--bin" ]; then\n  printf '${toolBin}\\n'\n  exit 0\nfi\nexit 1\n`,
    );
    writeFileSync(join(toolBin, "rdt"), "#!/bin/sh\nprintf 'rdt shim ok\\n'\n");
    chmodSync(join(uvBin, "uv"), 0o755);
    chmodSync(join(toolBin, "rdt"), 0o755);
    vi.stubEnv("PATH", uvBin);
    vi.stubEnv("HOME", join(root, "home"));

    const result = await runExternalToolCommand("rdt", ["--version"], { timeoutMs: 1000 });

    expect(result).toMatchObject({ code: 0, stdout: "rdt shim ok\n", stderr: "" });

    rmSync(root, { recursive: true, force: true });
  });

  it("still reports ENOENT when neither PATH nor uv shim candidates contain the command", async () => {
    await expect(
      runExternalToolCommand("definitely-not-an-opencandle-tool", [], { timeoutMs: 1000 }),
    ).rejects.toMatchObject({ code: "ENOENT" });
  });
});
