import {mkdirSync, readFileSync, writeFileSync} from "node:fs";
import {resolve} from "node:path";
import OpenAI from "openai";

if (!process.env.OPENAI_API_KEY) {
  try {
    process.loadEnvFile(resolve(process.cwd(), "../.env"));
  } catch {
    // The explicit error below is clearer than Node's missing-file message.
  }
}

if (!process.env.OPENAI_API_KEY) {
  throw new Error("OPENAI_API_KEY is not set and was not found in ../.env");
}

const script = readFileSync(resolve(process.cwd(), "VOICEOVER_SCRIPT.txt"), "utf8").trim();
const client = new OpenAI({apiKey: process.env.OPENAI_API_KEY});

const completion = await client.chat.completions.create({
  model: "gpt-audio-1.5",
  modalities: ["text", "audio"],
  audio: {voice: "cedar", format: "wav"},
  messages: [
    {
      role: "system",
      content:
        "Record the final voiceover immediately, beginning with the first supplied word and ending after the final supplied word. Do not acknowledge the request, introduce the reading, add a preamble, or add a closing remark. Read as a thoughtful human product narrator: grounded, warm, precise, and quietly confident. Use a neutral North American accent and roughly 132 words per minute. Let each paragraph breathe with a natural pause. Understate the delivery; never sound like an announcer or a financial advertisement. Gently emphasize ‘shallow answers’, ‘finance-specific tools’, ‘OpenCandle CLI’, and ‘inspect and verify’. Pronounce ‘npx opencandle’ as ‘N P X OpenCandle’. Speak only the supplied narration verbatim.",
    },
    {
      role: "user",
      content: script,
    },
  ],
});

const audio = completion.choices[0]?.message?.audio;
if (!audio?.data) {
  throw new Error("The audio model returned no audio payload");
}

mkdirSync(resolve(process.cwd(), "public"), {recursive: true});
writeFileSync(resolve(process.cwd(), "public/voiceover-v3.wav"), Buffer.from(audio.data, "base64"));

const transcript = audio.transcript?.trim();
if (transcript) {
  writeFileSync(resolve(process.cwd(), "public/voiceover-v3-transcript.txt"), `${transcript}\n`);
}

console.log(`Generated public/voiceover-v3.wav with gpt-audio-1.5 / cedar (${script.split(/\s+/).length} words).`);
