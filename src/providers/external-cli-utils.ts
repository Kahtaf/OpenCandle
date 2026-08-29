export interface CliErrorEnvelope {
  code?: string;
  message: string;
}

export function parseCliErrorEnvelope(stdout: string): CliErrorEnvelope | null {
  try {
    const parsed = JSON.parse(stdout) as {
      ok?: unknown;
      error?: { code?: unknown; message?: unknown };
    };
    if (parsed.ok !== false || typeof parsed.error?.message !== "string") return null;
    return {
      code: typeof parsed.error.code === "string" ? parsed.error.code : undefined,
      message: parsed.error.message,
    };
  } catch {
    return null;
  }
}

export function normalizeExternalTimestamp(value: unknown): string {
  if (typeof value === "number" && Number.isFinite(value)) {
    const millis = value > 1_000_000_000_000 ? value : value * 1000;
    return new Date(millis).toISOString();
  }
  if (typeof value === "string" && value.length > 0) {
    const millis = Date.parse(value);
    if (!Number.isNaN(millis)) return new Date(millis).toISOString();
  }
  return new Date(0).toISOString();
}
