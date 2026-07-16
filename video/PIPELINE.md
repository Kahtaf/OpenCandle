# OpenCandle launch video pipeline

The release video has one canonical timing and routing source: [`pipeline/launch-pipeline.json`](pipeline/launch-pipeline.json).

## Canonical inputs

- Narration: `VOICEOVER_SCRIPT.txt` → `public/voiceover-v3.wav`
- TUI: `public/approved/tui.mp4`
- GUI: `public/approved/gui.mp4`, rendered from the editable `src/surfaces/GuiSurface.tsx` composition
- GUI opening-state match: `public/approved/gui-start.png`
- Browser feature tour: `public/approved/architecture.mp4`, continuing directly from GUI frame 593
- Chatbot marks: official OpenAI, Claude, Google Gemini, and Grok SVGs under `public/brands/`

The checked-in files under `public/approved/` are the canonical surface inputs, so a clean checkout can render the full launch without relying on ignored local output. Run `npm run render:approved-surfaces` after editing the GUI or TUI compositions. The hook holds the complete finance-source network long enough to scan, resolves into a still made from the GUI's opening frame, then cuts on a pixel match into the signed-off browser render.

## Beat routing

| Beat | Visual source | Single job |
| --- | --- | --- |
| Replace uncertainty with evidence | Sequential red/green market candles, finance-themed question marks, official general-purpose chatbot marks, and enlarged finance-source cards resolving into the editable browser surface | Contrast shallow output with visible research, then enter the workflow without a visual reset |
| Browser question and trace | Editable browser Remotion surface matching the approved render | Demonstrate the complete primary investigation surface |
| Routing and evidence | Extended editable browser Remotion surface | Inspect actual tool calls, sources, the selected model, and the answer's attached research trail |
| Continue in CLI | Approved CLI | Show the precise command-line workflow |
| Browser and CLI control | Enlarged, overlapping approved browser + CLI frames | Establish user choice without a long static hold |
| Closing reframe | Brand + install command | Give one direct action |

Each beat declares its frame range, overlap, narration range, focal point, and QA frame in the manifest. Validation rejects timeline gaps, missing assets, beats without a narrative role, and designed overlays longer than eight words.

## Commands

```bash
npm run test:pipeline
npm run pipeline:validate
npm run render:approved-surfaces
npm run render:stills
npm run render
```

`npm run render` stages approved assets, runs pipeline tests, validates the manifest, checks TypeScript and ESLint, renders one QA still per beat, renders the MP4, and creates `out/review/index.html`.

Use `npm run render:with-voice` only when the narration script changes and a new OpenAI voice render is intended.
