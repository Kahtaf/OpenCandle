import {mkdirSync, readFileSync, writeFileSync} from "node:fs";
import {resolve} from "node:path";

const projectRoot = process.cwd();
const pipeline = JSON.parse(
  readFileSync(resolve(projectRoot, "pipeline/launch-pipeline.json"), "utf8"),
);
const reviewDir = resolve(projectRoot, "out/review");
mkdirSync(reviewDir, {recursive: true});

const chapters = pipeline.beats.map((beat) => {
  const seconds = beat.from / pipeline.fps;
  return `<button data-time="${seconds}" title="${beat.narrativeRole}">
    <span>${beat.id.replaceAll("-", " ")}</span>
    <time>${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, "0")}</time>
  </button>`;
}).join("\n");

const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>OpenCandle launch video review</title>
  <style>
    :root { color-scheme: dark; font-family: Inter, ui-sans-serif, system-ui, sans-serif; }
    * { box-sizing: border-box; }
    body { margin: 0; min-height: 100vh; background: #070908; color: #f5f0e4; }
    main { width: min(1280px, calc(100% - 32px)); margin: 0 auto; padding: 32px 0 56px; }
    header { display: flex; align-items: end; justify-content: space-between; gap: 24px; margin-bottom: 20px; }
    h1 { margin: 0; font-size: clamp(24px, 4vw, 46px); letter-spacing: -.045em; }
    p { margin: 7px 0 0; color: #9ea39d; }
    video { display: block; width: 100%; aspect-ratio: 16/9; background: #000; border: 1px solid #252a26; border-radius: 16px; box-shadow: 0 30px 90px rgba(0,0,0,.4); }
    nav { display: grid; grid-template-columns: repeat(5, 1fr); gap: 8px; margin-top: 12px; }
    button { display: flex; justify-content: space-between; gap: 12px; border: 1px solid #2e332f; border-radius: 10px; padding: 12px 13px; background: #111512; color: #e8e4da; cursor: pointer; text-align: left; }
    button:hover { border-color: #c49135; background: #171a17; }
    button span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; text-transform: capitalize; }
    time { color: #cda451; font-variant-numeric: tabular-nums; }
    footer { margin-top: 20px; color: #777d77; font-size: 13px; }
    @media (max-width: 800px) { nav { grid-template-columns: 1fr 1fr; } header { align-items: start; flex-direction: column; } }
  </style>
</head>
<body>
  <main>
    <header>
      <div>
        <h1>OpenCandle launch video</h1>
        <p>${pipeline.message}</p>
      </div>
      <p>${pipeline.totalFrames / pipeline.fps}s · ${pipeline.width}×${pipeline.height} · ${pipeline.fps} fps</p>
    </header>
    <video id="video" controls preload="metadata" src="../opencandle-release-pipeline.mp4"></video>
    <nav aria-label="Video chapters">${chapters}</nav>
    <footer>Approved TUI, GUI, and architecture renders are treated as frozen source assets.</footer>
  </main>
  <script>
    const video = document.querySelector('#video');
    document.querySelectorAll('[data-time]').forEach((button) => {
      button.addEventListener('click', () => {
        video.currentTime = Number(button.dataset.time);
        video.play();
      });
    });
  </script>
</body>
</html>`;

writeFileSync(resolve(reviewDir, "index.html"), html);
console.log("Wrote out/review/index.html");
