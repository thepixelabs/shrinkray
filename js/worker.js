/* ============================================================
   Shrinkray — encoding worker
   Runs off the main thread so the page stays responsive while a
   video is re-encoded. The real work is WebCodecs, driven by
   Mediabunny; this file is the policy layer around it.
   ============================================================ */

import {
  ALL_FORMATS,
  BlobSource,
  BufferTarget,
  Conversion,
  ConversionCanceledError,
  Input,
  Mp4OutputFormat,
  Output,
  Quality,
  getFirstEncodableVideoCodec,
} from '../vendor/mediabunny.min.mjs';

import { CODEC_LABEL, FALLBACK, MAX_PASSES, MIN_VIDEO_BPS, computePlan } from './plan.js';

let active = null;      // running Conversion, so cancel() can reach it
let canceled = false;

const post = (msg, transfer) => self.postMessage(msg, transfer || []);

self.onmessage = async (e) => {
  const msg = e.data;
  try {
    if (msg.type === 'probe') {
      await probe(msg.file);
    } else if (msg.type === 'run') {
      canceled = false;
      await run(msg.file, msg.opts);
    } else if (msg.type === 'cancel') {
      canceled = true;
      if (active) await active.cancel();
    }
  } catch (err) {
    if (canceled || err instanceof ConversionCanceledError ||
        err?.name === 'ConversionCanceledError') {
      post({ type: 'canceled' });
    } else {
      post({ type: 'error', message: describe(err) });
    }
  } finally {
    active = null;
  }
};

function describe(err) {
  const m = String(err?.message ?? err ?? 'Unknown error');
  if (/not supported|unsupported|no .*decoder/i.test(m)) {
    return m + ' — this browser may not be able to decode that codec. ' +
      'Chrome and Edge handle the widest range.';
  }
  return m;
}

/* ------------------------------------------------------------
   Probe — read the file's shape without decoding all of it
   ------------------------------------------------------------ */

async function probe(file) {
  const input = new Input({ source: new BlobSource(file), formats: ALL_FORMATS });

  const video = await input.getPrimaryVideoTrack();
  if (!video) throw new Error('No video track found in this file.');

  const audio = await input.getPrimaryAudioTrack();

  const [width, height, codec, rotation] = await Promise.all([
    video.getDisplayWidth(),
    video.getDisplayHeight(),
    video.getCodec(),
    video.getRotation().catch(() => 0),
  ]);

  const duration = await input.computeDuration();

  /* Sampled, not exhaustive — scanning a 200 MB file just to print
     an FPS number is not worth the wait. */
  let fps = 0;
  let videoBitrate = 0;
  try {
    const s = await video.computePacketStats(150);
    fps = s.averagePacketRate;
    videoBitrate = s.averageBitrate;
  } catch { /* stats are cosmetic; never block on them */ }

  let audioInfo = null;
  if (audio) {
    audioInfo = {
      codec: await audio.getCodec().catch(() => null),
      channels: await audio.getNumberOfChannels().catch(() => null),
      sampleRate: await audio.getSampleRate().catch(() => null),
      bitrate: 0,
    };
    try {
      audioInfo.bitrate = (await audio.computePacketStats(150)).averageBitrate;
    } catch { /* cosmetic */ }
  }

  const mime = await input.getMimeType().catch(() => null);

  post({
    type: 'probed',
    info: {
      name: file.name, size: file.size, mime,
      width, height, codec, rotation, duration, fps, videoBitrate,
      audio: audioInfo,
    },
  });

  input.dispose();
}

/* ------------------------------------------------------------
   Run
   ------------------------------------------------------------ */

async function run(file, o) {
  const src = o.src;
  if (!src.duration || !isFinite(src.duration) || src.duration <= 0) {
    throw new Error('Could not determine the length of this video.');
  }

  /* --- codec: honour the request if this browser can do it ------- */
  let codec = o.codec;
  const probePlan = computePlan(src, o, codec);
  const picked = await getFirstEncodableVideoCodec(FALLBACK[codec] ?? FALLBACK.avc, {
    width: probePlan.dims.width,
    height: probePlan.dims.height,
  });
  if (!picked) throw new Error('This browser has no usable video encoder.');
  if (picked !== codec) {
    post({
      type: 'note',
      message: `${CODEC_LABEL[codec]} can't be encoded here — using ${CODEC_LABEL[picked]} instead.`,
    });
    codec = picked;
  }

  /* --- plan with the codec we actually got ----------------------- */
  const plan = computePlan(src, o, codec);
  let videoBps = plan.videoBps;

  let result = null;
  let pass = 0;

  while (pass < MAX_PASSES) {
    pass++;
    post({ type: 'pass', pass, of: o.mode === 'size' ? MAX_PASSES : 1 });

    const quality = o.mode === 'size'
      ? new Quality({ bitrate: Math.round(videoBps), bitrateMode: 'variable' })
      : new Quality({ quality: o.quality });

    result = await encodeOnce(file, {
      dims: plan.dims,
      fps: plan.fps,
      codec,
      quality,
      keepAudio: plan.keepAudio,
      audioQuality: new Quality({ bitrate: 128_000 }),
    });

    if (o.mode !== 'size') break;
    if (result.size <= plan.targetBytes) break;
    if (pass >= MAX_PASSES) break;

    /* Overshot. Scale the bitrate by how far off we were, with a
       little extra bite so the next pass lands inside the limit
       rather than balanced on its edge. */
    const overshoot = result.size / plan.targetBytes;
    const next = (videoBps + plan.audioBps) / overshoot * 0.94 - plan.audioBps;
    const scaled = Math.max(MIN_VIDEO_BPS, next);
    if (scaled >= videoBps * 0.995) break;      // no headroom left to give
    videoBps = scaled;

    post({ type: 'retry', pass, was: result.size, target: plan.targetBytes });
  }

  post({
    type: 'done',
    buffer: result.buffer,
    size: result.size,
    width: plan.dims.width,
    height: plan.dims.height,
    fps: plan.fps ?? src.fps,
    codec,
    codecLabel: CODEC_LABEL[codec],
    hasAudio: plan.keepAudio,
    passes: pass,
    overTarget: o.mode === 'size' && result.size > plan.targetBytes,
    targetBytes: plan.targetBytes,
  }, [result.buffer]);
}

/* ------------------------------------------------------------
   One encode
   ------------------------------------------------------------ */

async function encodeOnce(file, cfg) {
  const input = new Input({ source: new BlobSource(file), formats: ALL_FORMATS });
  const output = new Output({
    /* Fast Start puts the index at the front of the file, so the
       result plays before it has fully downloaded — which is also
       what messaging apps expect. */
    format: new Mp4OutputFormat({ fastStart: 'in-memory' }),
    target: new BufferTarget(),
  });

  const conversion = await Conversion.init({
    input,
    output,
    video: {
      width: cfg.dims.width,
      height: cfg.dims.height,
      fit: 'fill',
      ...(cfg.fps ? { frameRate: cfg.fps } : {}),
      codec: cfg.codec,
      quality: cfg.quality,
      process: makePreview(cfg.dims),
    },
    audio: cfg.keepAudio
      ? { codec: 'aac', quality: cfg.audioQuality }
      : { discard: true },
    showWarnings: false,
  });

  if (!conversion.isValid) {
    const why = conversion.discardedTracks
      .map((d) => `${d.track.type}: ${d.reason.replace(/_/g, ' ')}`)
      .join('; ');
    throw new Error(`This file can't be converted here${why ? ` (${why})` : ''}.`);
  }

  let last = 0;
  conversion.onProgress = (p, t) => {
    const now = performance.now();
    if (now - last < 66 && p < 1) return;      // ~15 updates a second is plenty
    last = now;
    post({ type: 'progress', p, t });
  };

  active = conversion;
  await conversion.execute();
  active = null;

  const buffer = output.target.buffer;
  input.dispose();

  if (!buffer) throw new Error('Encoding finished but produced no data.');
  return { buffer, size: buffer.byteLength };
}

/* ------------------------------------------------------------
   Live preview
   Frames reach `process` already resized and frame-rate corrected,
   so what we draw is exactly what is being written. Entirely
   best-effort: if anything here throws, the preview switches off
   and the encode carries on.
   ------------------------------------------------------------ */

function makePreview(dims) {
  let canvas = null;
  let ctx = null;
  let lastFrame = 0;
  let dead = false;

  return (sample) => {
    if (dead) return sample;
    const now = performance.now();
    if (now - lastFrame < 110) return sample;
    lastFrame = now;

    try {
      const sw = sample.displayWidth || dims.width;
      const sh = sample.displayHeight || dims.height;
      const maxDim = 480;
      let w, h;
      if (sw >= sh) {
        w = maxDim;
        h = Math.max(2, Math.round(maxDim * sh / sw));
      } else {
        h = maxDim;
        w = Math.max(2, Math.round(maxDim * sw / sh));
      }

      if (!canvas || canvas.width !== w || canvas.height !== h) {
        canvas = new OffscreenCanvas(w, h);
        ctx = canvas.getContext('2d');
        if (!ctx) { dead = true; return sample; }
      }
      sample.draw(ctx, 0, 0, w, h);
      const bitmap = canvas.transferToImageBitmap();
      post({ type: 'frame', bitmap }, [bitmap]);
    } catch {
      dead = true;
    }
    return sample;
  };
}
