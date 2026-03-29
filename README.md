# Vantage

A financial advisory coding agent built from scratch with raw HTTP calls to the Gemini API. No SDKs, no frameworks — just TypeScript and `fetch`.

Vantage helps investors and traders with market analysis, portfolio decisions, and trading strategies.

## Setup

1. Get a free Gemini API key at https://aistudio.google.com/apikey
2. Copy your key into `.env`:
   ```
   GEMINI_API_KEY=your-key-here
   ```

## Run

```bash
npx tsx agent.ts
```

## Tools

| Tool | Description |
|------|-------------|
| `list_files` | List files and directories |
| `read_file` | Read file contents |
| `run_bash` | Execute shell commands |
| `edit_file` | Create and edit files |

## How it works

An LLM in a loop with tools — the same architecture behind every coding agent:

```
user input → LLM → tool call → execute → result → LLM → ... → text response
```

Built incrementally in 8 steps. Run `git log --oneline` to see the progression.
