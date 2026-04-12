/**
 * Exa MCP endpoint contract test.
 * Hits the live endpoint to verify the response shape hasn't changed.
 * Run with: npx tsx tests/e2e/exa-mcp-contract.test.ts
 */

const EXA_MCP_URL = "https://mcp.exa.ai/mcp";

async function testExaMcpContract(): Promise<void> {
  console.log("Testing Exa MCP endpoint contract...\n");

  const response = await fetch(EXA_MCP_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: {
        name: "web_search_exa",
        arguments: {
          query: "AAPL stock news",
          numResults: 2,
          livecrawl: "fallback",
          type: "auto",
          contextMaxCharacters: 1000,
        },
      },
    }),
    signal: AbortSignal.timeout(15_000),
  });

  assert(response.ok, `HTTP ${response.status} ${response.statusText}`);

  const body = await response.text();

  // Extract JSON-RPC payload (SSE or plain JSON)
  let payload: any;
  const dataLine = body.split("\n").find((l) => l.startsWith("data:"));
  if (dataLine) {
    payload = JSON.parse(dataLine.slice(5).trim());
  } else {
    payload = JSON.parse(body);
  }

  // JSON-RPC structure
  assert(payload.jsonrpc === "2.0", `Expected jsonrpc "2.0", got "${payload.jsonrpc}"`);
  assert(payload.result, "Missing result field");
  assert(Array.isArray(payload.result.content), "result.content is not an array");
  assert(payload.result.content.length > 0, "result.content is empty");
  assert(payload.result.content[0].type === "text", `Expected content type "text", got "${payload.result.content[0].type}"`);

  const text: string = payload.result.content[0].text;
  assert(text.length > 0, "result text is empty");

  // Result block fields
  assert(/^Title: .+/m.test(text), "No Title: field found in results");
  assert(/^URL: https?:\/\/.+/m.test(text), "No URL: field found in results");

  // Count result blocks
  const blocks = text.split(/\n---\n/).filter((b: string) => b.trim().length > 0);
  console.log(`  ✓ HTTP ${response.status}`);
  console.log(`  ✓ JSON-RPC 2.0 response`);
  console.log(`  ✓ ${blocks.length} result blocks with Title/URL fields`);
  console.log(`  ✓ Content-Type: ${response.headers.get("content-type")}`);
  console.log(`\nPASS: Exa MCP contract`);
}

function assert(condition: boolean, msg: string): void {
  if (!condition) {
    console.error(`FAIL: ${msg}`);
    process.exit(1);
  }
}

testExaMcpContract().catch((err) => {
  console.error("FAIL:", err.message);
  process.exit(1);
});
