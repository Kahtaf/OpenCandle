# Vantage

gemini/typescript coding agent built from scratch with raw HTTP calls.

## Setup
1. Add your API key to `.env`
2. Key URL: https://aistudio.google.com/apikey

## Run
`npx tsx agent.ts`

## How it works
Agentic loop: prompt -> LLM -> tool call -> execute -> result back -> LLM -> ... -> text response

## Tools
- [x] list_files
- [ ] read_file
- [ ] run_bash
- [ ] edit_file

## Structure
- `agent.ts` -- main agent source
- `.env` -- API key (gitignored)
