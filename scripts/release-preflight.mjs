import { pathToFileURL } from "node:url";

const model = "gemini-2.5-flash";

export async function verifyReleaseModel(env = process.env, request = fetch) {
  const apiKey = env.GEMINI_API_KEY?.trim() || env.GOOGLE_API_KEY?.trim();
  if (!apiKey) throw new Error("Set GEMINI_API_KEY or GOOGLE_API_KEY in the release environment");
  let response;
  try {
    response = await request(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
      {
        method: "POST",
        headers: { "content-type": "application/json", "x-goog-api-key": apiKey },
        body: JSON.stringify({
          contents: [{ parts: [{ text: "Reply OK." }] }],
          generationConfig: { maxOutputTokens: 16, thinkingConfig: { thinkingBudget: 0 } },
        }),
        signal: AbortSignal.timeout(15_000),
      },
    );
  } catch {
    throw new Error(`Release model google/${model} could not be reached`);
  }
  if (!response.ok) {
    throw new Error(
      `Release model google/${model} rejected the preflight (HTTP ${response.status})`,
    );
  }
  const result = await response.json().catch(() => null);
  if (
    !result?.candidates?.some((candidate) =>
      candidate.content?.parts?.some((part) => part.text?.trim()),
    )
  ) {
    throw new Error(`Release model google/${model} returned no text in preflight`);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    await verifyReleaseModel();
    console.log(`Release model google/${model} passed preflight`);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
