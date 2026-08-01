import { timingSafeEqual } from "node:crypto";

export const PRIVATE_RUNTIME_TOKEN_HEADER = "x-opencandle-runtime-token";

interface PrivateRuntimeRequestIdentity {
  origin?: string;
  runtimeToken?: string;
}

interface PrivateRuntimeAuthorization {
  trustedOrigin: string;
  runtimeToken: string;
}

export function isAuthorizedPrivateRuntimeRequest(
  request: PrivateRuntimeRequestIdentity,
  authorization: PrivateRuntimeAuthorization,
): boolean {
  if (request.origin !== undefined && request.origin !== authorization.trustedOrigin) return false;
  return securelyMatches(request.runtimeToken, authorization.runtimeToken);
}

function securelyMatches(candidate: string | undefined, expected: string): boolean {
  if (!candidate || !/^[a-f0-9]{32}$/.test(candidate) || !/^[a-f0-9]{32}$/.test(expected)) {
    return false;
  }
  return timingSafeEqual(Buffer.from(candidate, "hex"), Buffer.from(expected, "hex"));
}
