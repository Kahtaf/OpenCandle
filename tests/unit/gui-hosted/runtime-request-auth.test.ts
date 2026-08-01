import { describe, expect, it } from "vitest";
import { isAuthorizedPrivateRuntimeRequest } from "../../../gui/hosted/runtime/runtime-request-auth.js";

describe("private hosted runtime request authorization", () => {
  const trustedOrigin = "https://web.opencandle.app";
  const runtimeToken = "a".repeat(32);

  it("requires the private runtime token even for the exact trusted browser origin", () => {
    expect(
      isAuthorizedPrivateRuntimeRequest({ origin: trustedOrigin }, { trustedOrigin, runtimeToken }),
    ).toBe(false);
    expect(
      isAuthorizedPrivateRuntimeRequest(
        { origin: trustedOrigin, runtimeToken },
        { trustedOrigin, runtimeToken },
      ),
    ).toBe(true);
  });

  it("requires the private runtime token when Origin is absent", () => {
    expect(
      isAuthorizedPrivateRuntimeRequest({ runtimeToken }, { trustedOrigin, runtimeToken }),
    ).toBe(true);
    expect(isAuthorizedPrivateRuntimeRequest({}, { trustedOrigin, runtimeToken })).toBe(false);
    expect(
      isAuthorizedPrivateRuntimeRequest(
        { runtimeToken: "b".repeat(32) },
        { trustedOrigin, runtimeToken },
      ),
    ).toBe(false);
  });

  it("does not let a token override an untrusted browser origin", () => {
    expect(
      isAuthorizedPrivateRuntimeRequest(
        { origin: "https://attacker.example", runtimeToken },
        { trustedOrigin, runtimeToken },
      ),
    ).toBe(false);
  });
});
