import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { ensureParentDir, getOnboardingPath } from "../infra/vantage-paths.js";

export const ONBOARDING_VERSION = 1;

export interface OnboardingState {
  version: number;
  financeSetupStatus?: "dismissed" | "completed";
}

export function getDefaultOnboardingState(): OnboardingState {
  return { version: ONBOARDING_VERSION };
}

export function loadOnboardingState(path = getOnboardingPath()): OnboardingState {
  if (!existsSync(path)) {
    return getDefaultOnboardingState();
  }

  try {
    const parsed = JSON.parse(readFileSync(path, "utf-8")) as OnboardingState;
    if (!parsed || typeof parsed !== "object") {
      return getDefaultOnboardingState();
    }
    return {
      version: typeof parsed.version === "number" ? parsed.version : ONBOARDING_VERSION,
      financeSetupStatus:
        parsed.financeSetupStatus === "completed" || parsed.financeSetupStatus === "dismissed"
          ? parsed.financeSetupStatus
          : undefined,
    };
  } catch {
    return getDefaultOnboardingState();
  }
}

export function saveOnboardingState(state: OnboardingState, path = getOnboardingPath()): void {
  ensureParentDir(path);
  writeFileSync(path, `${JSON.stringify(state, null, 2)}\n`, "utf-8");
}
