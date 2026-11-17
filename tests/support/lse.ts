import usageFixture from "../fixtures/lse/v3-usage-free.json";

// Encode provider-native rows for fetch-boundary tests, independently of the parser.
export function lseCsvResponse(
  rows: Record<string, unknown>[],
  headers: Record<string, string> = {},
): Response {
  const columns = [...new Set(rows.flatMap((row) => Object.keys(row)))];
  const field = (value: unknown) => `"${String(value ?? "").replaceAll('"', '""')}"`;
  const csv = [
    columns.map(field).join(","),
    ...rows.map((row) => columns.map((column) => field(row[column])).join(",")),
  ].join("\r\n");
  return new Response(`${csv}\r\n`, { headers: { "content-type": "text/csv", ...headers } });
}

export const lseUsageFixture = usageFixture;

export function withLseUsage(fetch: typeof globalThis.fetch): typeof globalThis.fetch {
  return (input, init) =>
    new URL(input instanceof Request ? input.url : String(input)).pathname === "/v3/usage"
      ? Promise.resolve(Response.json(lseUsageFixture))
      : fetch(input, init);
}
