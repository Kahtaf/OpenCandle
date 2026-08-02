import { describe, expect, it } from "vitest";
import { refreshHostedRuntimeStatus } from "../../../gui/hosted/src/hosted-runtime-status.js";

describe("hosted runtime status", () => {
  it("keeps an action error visible across background coordination refreshes", () => {
    expect(
      refreshHostedRuntimeStatus(
        {
          role: "writer",
          online: true,
          busy: false,
          message: "Running on this device",
          actionError: "Unsupported hosted archive version",
        },
        undefined,
        { role: "writer", online: false },
      ),
    ).toMatchObject({
      actionError: "Unsupported hosted archive version",
      message: "Offline: saved research is read-only",
    });
  });

  it("surfaces explicit runtime errors in the primary status", () => {
    expect(
      refreshHostedRuntimeStatus(
        { role: "writer", online: true, message: "Running on this device", actionError: "" },
        { error: "Runtime failed" },
        { role: "writer", online: true },
      ),
    ).toMatchObject({ message: "Runtime failed" });
  });

  it("states that a follower can act through the active runtime tab", () => {
    expect(
      refreshHostedRuntimeStatus(
        { role: "writer", online: true, message: "Running on this device", actionError: "" },
        undefined,
        { role: "follower", online: true },
      ),
    ).toMatchObject({ message: "Ready through the active tab" });
  });
});
