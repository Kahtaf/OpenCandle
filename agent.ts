import * as readline from "node:readline";
import { readFileSync, writeFileSync, readdirSync, existsSync } from "node:fs";
import { execSync } from "node:child_process";

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

const tools = [
  {
    functionDeclarations: [
      {
        name: "list_files",
        description: "List files and directories at the given path",
        parameters: {
          type: "object",
          properties: {
            directory: { type: "string", description: "Directory path to list" },
          },
          required: ["directory"],
        },
      },
      {
        name: "read_file",
        description: "Read the contents of a file at the given path",
        parameters: {
          type: "object",
          properties: {
            path: { type: "string", description: "File path to read" },
          },
          required: ["path"],
        },
      },
      {
        name: "run_bash",
        description: "Execute a bash command and return its output",
        parameters: {
          type: "object",
          properties: {
            command: { type: "string", description: "Bash command to execute" },
          },
          required: ["command"],
        },
      },
      {
        name: "edit_file",
        description:
          "Edit a file by replacing a specific string with new content. Can also create new files.",
        parameters: {
          type: "object",
          properties: {
            path: { type: "string", description: "File path to edit or create" },
            old_string: {
              type: "string",
              description:
                "String to find and replace (empty string to create new file or append)",
            },
            new_string: { type: "string", description: "Replacement string" },
          },
          required: ["path", "old_string", "new_string"],
        },
      },
    ],
  },
];

const messages: any[] = [];

function executeTool(name: string, args: any): string {
  switch (name) {
    case "list_files":
      return readdirSync(args.directory).join("\n");
    case "read_file":
      try {
        return readFileSync(args.path, "utf-8");
      } catch (e: any) {
        return `Error reading file: ${e.message}`;
      }
    case "run_bash":
      try {
        return execSync(args.command, {
          timeout: 30000,
          encoding: "utf-8",
          stdio: ["pipe", "pipe", "pipe"],
        });
      } catch (e: any) {
        const stdout = e.stdout || "";
        const stderr = e.stderr || "";
        return `Exit code ${e.status ?? 1}:\n${stdout}${stderr}`.trim();
      }
    case "edit_file": {
      const { path, old_string, new_string } = args;
      if (old_string === "") {
        if (!existsSync(path)) {
          writeFileSync(path, new_string);
          return `Created ${path}`;
        }
        const existing = readFileSync(path, "utf-8");
        writeFileSync(path, existing + new_string);
        return `Appended to ${path}`;
      }
      try {
        const content = readFileSync(path, "utf-8");
        const count = content.split(old_string).length - 1;
        if (count === 0) return `Error: old_string not found in ${path}`;
        if (count > 1) return `Error: old_string found ${count} times in ${path} (must be unique)`;
        writeFileSync(path, content.replace(old_string, new_string));
        return `Edited ${path}`;
      } catch (e: any) {
        return `Error editing file: ${e.message}`;
      }
    }
    default:
      return `Unknown tool: ${name}`;
  }
}

async function callApi(): Promise<any> {
  const body = {
    systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
    contents: messages,
    tools,
    generationConfig: { thinkingConfig: { thinkingBudget: 0 } },
  };

  const res = await fetch(GEMINI_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  return res.json();
}

async function chat(userMessage: string): Promise<string> {
  messages.push({ role: "user", parts: [{ text: userMessage }] });

  while (true) {
    const json: any = await callApi();
    const modelMessage = json.candidates[0].content;
    messages.push(modelMessage);

    const toolCalls = modelMessage.parts.filter((p: any) => p.functionCall);
    if (toolCalls.length === 0) {
      return modelMessage.parts[0].text;
    }

    const responseParts: any[] = [];
    for (const part of toolCalls) {
      const { name, args } = part.functionCall;
      console.log(`\n🔧 ${name}(${JSON.stringify(args)})`);
      const result = executeTool(name, args);
      console.log(`📄 ${result}`);
      responseParts.push({
        functionResponse: {
          name,
          response: { name, content: result },
        },
      });
    }

    messages.push({ role: "function", parts: responseParts });
  }
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
