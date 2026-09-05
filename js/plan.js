/* ============================================================
   Shrinkray — encoding plan
   Shared by the UI (to show what will happen before you commit)
   and the worker (to actually do it), so the preview and the
   result can never disagree.
   ============================================================ */

/* Decimal MB — 1,000,000 bytes, matching how file sizes are
   reported and enforced by most messaging and sharing platforms. */
export const MB = 1e6;

/* Long-edge ladder used when resolution is on Auto. */
export const LADDER = [3840, 2560, 1920, 1600, 1280, 960, 854, 640, 480, 360];

/* Bits per pixel per frame each codec needs to still look decent.
   Used to pick a resolution the chosen bitrate can actually carry —
   4K at 2 Mbps looks far worse than 1080p at 2 Mbps. Deliberately
   permissive: real content, and screen recordings especially,
   compress better than a generic estimate suggests. */
export const BPP = { avc: 0.050, hevc: 0.033, vp9: 0.036, av1: 0.028 };

export const CODEC_LABEL = { avc: 'H.264', hevc: 'H.265', av1: 'AV1', vp9: 'VP9' };

/* Fallback order when the requested codec has no encoder here. */
export const FALLBACK = {
  avc:  ['avc', 'hevc', 'av1', 'vp9'],
  hevc: ['hevc', 'avc', 'av1', 'vp9'],
  av1:  ['av1', 'hevc', 'avc', 'vp9'],
  vp9:  ['vp9', 'av1', 'avc', 'hevc'],
};

/* Headroom for container overhead when aiming at a size. */
export const SIZE_MARGIN = 0.96;
/* Never go below this video bitrate, however tight the target. */
export const MIN_VIDEO_BPS = 48_000;
/* Correcting re-encodes allowed when we overshoot the target. */
export const MAX_PASSES = 3;

export const even = (n) => Math.max(2, Math.round(n / 2) * 2);

/**
 * Largest ladder step the bitrate can carry.
 * The comparison comes out as `L² ≤ budget × 3.2` — 3.2 converts a
 * pixel budget into a long-edge-squared budget for typical 16:9-ish
 * material without needing the exact aspect ratio. It only has to
 * choose between ladder steps; the size-correcting passes clean up
 * whatever error is left.
 */
export function autoLongEdge(srcLong, videoBps, fps, codec) {
  const bpp = BPP[codec] ?? BPP.avc;
  const budget = videoBps / (Math.max(fps, 1) * bpp);
  for (const L of LADDER) {
    if (L > srcLong) continue;            // never upscale
    if (L * L <= budget * 3.2) return L;
  }
  return Math.min(srcLong, LADDER[LADDER.length - 1]);
}

export function planDims(src, longEdge) {
  const srcLong = Math.max(src.width, src.height);
  if (!longEdge || longEdge >= srcLong) {
    return { width: even(src.width), height: even(src.height) };
  }
  const s = longEdge / srcLong;
  return { width: even(src.width * s), height: even(src.height * s) };
}

export function planFps(srcFps, choice) {
  if (choice === '0') return null;                     // keep original
  if (choice !== 'auto') return Number(choice);
  if (!srcFps || !isFinite(srcFps)) return null;
  /* 120 fps is a display artefact, not something you perceive in a
     shared clip. Halving the frame count makes the bitrate go
     twice as far. */
  return srcFps > 61 ? 60 : null;
}

/** Everything the encoder needs, derived from the source + the UI. */
export function computePlan(src, o, codec) {
  const duration = src.duration;
  const fps = planFps(src.fps, o.fps);
  const effFps = fps ?? src.fps ?? 30;

  const keepAudio = o.audio === 'keep' && !!src.audio;
  /* If the source audio is already AAC, Mediabunny copies the packets
     through untouched — lossless and instant — so budget for what is
     actually there rather than for what we would have encoded. */
  const audioBps = keepAudio ? Math.min(src.audio.bitrate || 128_000, 320_000) : 0;

  const targetBytes = o.mode === 'size' ? Math.max(0.05 * MB, o.targetMB * MB) : 0;

  let videoBps = 0;
  if (o.mode === 'size' && duration > 0) {
    const totalBps = (targetBytes * 8 / duration) * SIZE_MARGIN;
    videoBps = Math.max(MIN_VIDEO_BPS, totalBps - audioBps);
  }

  const srcLong = Math.max(src.width, src.height);
  let longEdge;
  if (o.res === 'auto') {
    longEdge = o.mode === 'size'
      ? autoLongEdge(srcLong, videoBps, effFps, codec)
      : Math.min(srcLong, 1920);
  } else {
    longEdge = Number(o.res) || 0;      // 0 = keep original
  }

  return {
    dims: planDims(src, longEdge),
    fps, effFps, keepAudio, audioBps, targetBytes, videoBps, longEdge,
  };
}
