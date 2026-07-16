import {existsSync} from "node:fs";
import {resolve} from "node:path";

const validSurfaces = new Set(["proof", "tui", "architecture", "gui", "dual", "cta"]);

const countWords = (value) => value.trim().split(/\s+/).filter(Boolean).length;

export function validatePipeline(pipeline, {projectRoot, requireStaged = false} = {}) {
  const errors = [];
  const root = projectRoot ?? process.cwd();
  const beats = Array.isArray(pipeline?.beats) ? pipeline.beats : [];
  const assets = pipeline?.assets ?? {};

  if (!Number.isInteger(pipeline?.fps) || pipeline.fps <= 0) {
    errors.push("fps must be a positive integer");
  }
  if (!Number.isInteger(pipeline?.totalFrames) || pipeline.totalFrames <= 0) {
    errors.push("totalFrames must be a positive integer");
  }
  if (!pipeline?.message?.trim()) {
    errors.push("message must define the video's single promise");
  }
  if (beats.length === 0) {
    errors.push("beats must contain at least one visual beat");
  }

  for (const [assetId, asset] of Object.entries(assets)) {
    if (!asset?.source || !existsSync(resolve(root, asset.source))) {
      errors.push(`asset ${assetId}.source does not exist: ${asset?.source ?? "<missing>"}`);
    }
    if (requireStaged && (!asset?.public || !existsSync(resolve(root, asset.public)))) {
      errors.push(`asset ${assetId}.public is not staged: ${asset?.public ?? "<missing>"}`);
    }
    if (!Number.isInteger(asset?.durationFrames) || asset.durationFrames <= 0) {
      errors.push(`asset ${assetId}.durationFrames must be a positive integer`);
    }
  }

  const ids = new Set();
  const sorted = [...beats].sort((a, b) => a.from - b.from);
  sorted.forEach((beat, index) => {
    const label = beat?.id || `beat ${index}`;
    if (!beat?.id || ids.has(beat.id)) {
      errors.push(`${label}.id must be present and unique`);
    }
    ids.add(beat?.id);
    if (!validSurfaces.has(beat?.surface)) {
      errors.push(`${label}.surface is invalid`);
    }
    if (!Number.isInteger(beat?.from) || beat.from < 0) {
      errors.push(`${label}.from must be a non-negative integer`);
    }
    if (!Number.isInteger(beat?.duration) || beat.duration <= 0) {
      errors.push(`${label}.duration must be a positive integer`);
    }
    if (!beat?.narrativeRole?.trim()) {
      errors.push(`${label}.narrativeRole must define exactly one job`);
    }
    if (!beat?.focalPoint?.trim()) {
      errors.push(`${label}.focalPoint must identify the viewer's focus`);
    }
    if (countWords(beat?.onScreenText ?? "") > 8) {
      errors.push(`${label}.onScreenText must contain no more than 8 words`);
    }
    if (!Array.isArray(beat?.voiceover) || beat.voiceover.length !== 2) {
      errors.push(`${label}.voiceover must be a [start, end] frame pair`);
    }
    if (!Number.isInteger(beat?.qaFrame) || beat.qaFrame < beat.from || beat.qaFrame >= beat.from + beat.duration) {
      errors.push(`${label}.qaFrame must fall inside the beat`);
    }
    if (["tui", "gui", "architecture"].includes(beat?.surface)) {
      const asset = assets[beat.surface];
      if (!asset) {
        errors.push(`${label} references missing asset ${beat.surface}`);
      }
      if (!(beat?.playbackRate > 0)) {
        errors.push(`${label}.playbackRate must be positive`);
      }
      const trimBefore = beat?.trimBefore ?? 0;
      if (!Number.isInteger(trimBefore) || trimBefore < 0) {
        errors.push(`${label}.trimBefore must be a non-negative integer`);
      } else if (
        asset
        && beat?.playbackRate > 0
        && trimBefore + beat.duration * beat.playbackRate > asset.durationFrames + 0.001
      ) {
        errors.push(`${label}.trimBefore and playback duration must fit inside the source render`);
      }
    }

    if (index === 0 && beat.from !== 0) {
      errors.push("the first beat must start at frame 0");
    }
    if (index > 0) {
      const previous = sorted[index - 1];
      const previousEnd = previous.from + previous.duration;
      if (beat.from > previousEnd) {
        errors.push(`gap between ${previous.id} and ${label}`);
      }
      const overlap = Math.max(0, previousEnd - beat.from);
      if (overlap !== beat.transitionIn) {
        errors.push(`${label}.transitionIn must equal its ${overlap}-frame overlap`);
      }
    }
  });

  const visualEnd = sorted.length === 0
    ? 0
    : Math.max(...sorted.map((beat) => beat.from + beat.duration));
  if (visualEnd !== pipeline?.totalFrames) {
    errors.push(`visual beats end at ${visualEnd}, expected totalFrames ${pipeline?.totalFrames}`);
  }
  if (!pipeline?.audio?.file) {
    errors.push("audio.file is required");
  } else if (!existsSync(resolve(root, "public", pipeline.audio.file))) {
    errors.push(`audio file does not exist: public/${pipeline.audio.file}`);
  }
  if (
    !Number.isInteger(pipeline?.audio?.durationFrames)
    || pipeline.audio.durationFrames <= 0
    || pipeline.audio.durationFrames > pipeline?.totalFrames
  ) {
    errors.push("audio.durationFrames must be a positive integer that fits inside totalFrames");
  }

  return {errors, totalFrames: pipeline?.totalFrames ?? 0, beats: beats.length};
}
