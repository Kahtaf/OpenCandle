import * as readline from "node:readline";
import { readFileSync } from "node:fs";

// Load .env file
const env = readFileSync(".env", "utf-8");
for (const line of env.split("\n")) {
  const [key, ...vals] = line.split("=");
  if (key?.trim() && vals.length) {
    const v = vals.join("=").trim();
    if (v && !v.startsWith("#")) process.env[key.trim()] = v;
  }
}

const API_KEY = process.env.GEMINI_API_KEY;
if (!API_KEY) {
  console.error("Missing GEMINI_API_KEY in .env file");
  process.exit(1);
}

const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${API_KEY}`;

const SYSTEM_PROMPT = `You are Vantage, a financial advisory agent for investors and traders. You help users with market analysis, portfolio decisions, and trading strategies.

You have access to tools that let you interact with the filesystem and run commands. Use tools proactively — for example, list files to understand a project before asking the user for specific paths.

Working directory: ${process.cwd()}

Be concise, data-driven, and actionable in your responses.`;

const messages: { role: string; parts: { text: string }[] }[] = [];

async function chat(userMessage: string): Promise<string> {
  messages.push({ role: "user", parts: [{ text: userMessage }] });

  const body = {
    systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
    contents: messages,
    generationConfig: { thinkingConfig: { thinkingBudget: 0 } },
  };

  const res = await fetch(GEMINI_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  const json = await res.json();
  const modelMessage = json.candidates[0].content;
  messages.push(modelMessage);
  return modelMessage.parts[0].text;
}

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const prompt = (q: string): Promise<string> =>
  new Promise((resolve) => rl.question(q, resolve));

async function main() {
  console.log("Vantage is ready. Type a message or Ctrl+C to exit.\n");
  while (true) {
    const input = await prompt("> ");
    if (!input.trim()) continue;
    const response = await chat(input);
    console.log(`\n${response}\n`);
  }
}

main().catch(console.error);
