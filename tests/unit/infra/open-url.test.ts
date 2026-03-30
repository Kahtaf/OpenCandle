import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("node:child_process", () => ({
  execFile: vi.fn(),
}));

import { execFile } from "node:child_process";
import { openInBrowser } from "../../../src/infra/open-url.js";

const mockExecFile = vi.mocked(execFile);

function stubExecFile(error: Error | null = null) {
  mockExecFile.mockImplementation((_cmd: any, _args: any, _opts: any, cb: any) => {
    cb(error);
    return { unref: vi.fn() } as any;
  });
}

describe("openInBrowser", () => {
  const originalPlatform = process.platform;

  afterEach(() => {
    Object.defineProperty(process, "platform", { value: originalPlatform });
    vi.restoreAllMocks();
  });

  it("uses 'open' on macOS", async () => {
    Object.defineProperty(process, "platform", { value: "darwin" });
    stubExecFile();

    await openInBrowser("https://example.com");

    expect(mockExecFile).toHaveBeenCalledWith(
      "open",
      ["https://example.com"],
      expect.objectContaining({ timeout: 5000 }),
      expect.any(Function),
    );
  });

  it("uses 'xdg-open' on Linux", async () => {
    Object.defineProperty(process, "platform", { value: "linux" });
    stubExecFile();

    await openInBrowser("https://example.com");

    expect(mockExecFile).toHaveBeenCalledWith(
      "xdg-open",
      ["https://example.com"],
      expect.objectContaining({ timeout: 5000 }),
      expect.any(Function),
    );
  });

  it("uses 'cmd /c start' on Windows", async () => {
    Object.defineProperty(process, "platform", { value: "win32" });
    stubExecFile();

    await openInBrowser("https://example.com");

    expect(mockExecFile).toHaveBeenCalledWith(
      "cmd",
      ["/c", "start", "", "https://example.com"],
      expect.objectContaining({ timeout: 5000 }),
      expect.any(Function),
    );
  });

  it("rejects when the command fails", async () => {
    Object.defineProperty(process, "platform", { value: "darwin" });
    stubExecFile(new Error("command not found"));

    await expect(openInBrowser("https://example.com")).rejects.toThrow("command not found");
  });
});
