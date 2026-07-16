import {createReadStream, existsSync, writeFileSync} from "node:fs";
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

const audioPath = resolve(process.cwd(), "public/voiceover-v3.wav");
if (!existsSync(audioPath)) {
  throw new Error("Generate public/voiceover-v3.wav before transcribing it");
}

const client = new OpenAI({apiKey: process.env.OPENAI_API_KEY});
const transcription = await client.audio.transcriptions.create({
  file: createReadStream(audioPath),
  model: "whisper-1",
  response_format: "verbose_json",
  timestamp_granularities: ["word"],
});

const words = transcription.words ?? [];
const captions = words.map((word) => ({
  text: word.word.startsWith(" ") ? word.word : ` ${word.word}`,
  startMs: Math.round(word.start * 1000),
  endMs: Math.round(word.end * 1000),
  timestampMs: Math.round(word.start * 1000),
  confidence: null,
}));

if (captions.length === 0) {
  throw new Error("The transcription returned no word timestamps");
}

writeFileSync(resolve(process.cwd(), "public/voiceover-v3-timings.json"), `${JSON.stringify(captions, null, 2)}\n`);
writeFileSync(resolve(process.cwd(), "public/voiceover-v3-transcription.json"), `${JSON.stringify(transcription, null, 2)}\n`);
console.log(`Wrote ${captions.length} word timings to public/voiceover-v3-timings.json.`);
