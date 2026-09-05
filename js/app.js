/* ============================================================
   Shrinkray — interface
   Owns the stage machine (drop → setup → run → done), the live
   plan readout, and the conversation with the encoding worker.
   ============================================================ */

import { CODEC_LABEL, MB, computePlan } from './plan.js';

const $ = (id) => document.getElementById(id);

/* ------------------------------------------------------------
   Formatting
   ------------------------------------------------------------ */

function fmtBytes(n) {
  if (!isFinite(n) || n < 0) return '—';
  if (n < 1000) return `${n} B`;
  if (n < MB) return `${(n / 1000).toFixed(0)} KB`;
  if (n < 1000 * MB) return `${(n / MB).toFixed(n < 10 * MB ? 2 : 1)} MB`;
  return `${(n / (1000 * MB)).toFixed(2)} GB`;
}

function fmtTime(s) {
  if (!isFinite(s) || s < 0) s = 0;
  const m = Math.floor(s / 60);
  const r = Math.floor(s % 60);
  return `${m}:${String(r).padStart(2, '0')}`;
}

function fmtRate(bps) {
  if (!bps || !isFinite(bps)) return '—';
  return bps >= 1e6 ? `${(bps / 1e6).toFixed(1)} Mbps` : `${Math.round(bps / 1e3)} kbps`;
}

const CODEC_NAMES = {
  avc: 'H.264', hevc: 'H.265', av1: 'AV1', vp9: 'VP9', vp8: 'VP8',
  aac: 'AAC', opus: 'Opus', mp3: 'MP3', flac: 'FLAC', vorbis: 'Vorbis',
};
const niceCodec = (c) => (c ? (CODEC_NAMES[c] ?? c.toUpperCase()) : 'unknown');

/* ------------------------------------------------------------
   Capability check
   ------------------------------------------------------------ */

const CAPABLE =
  typeof VideoEncoder !== 'undefined' &&
  typeof VideoDecoder !== 'undefined' &&
  typeof Worker !== 'undefined';

$('engine-badge').textContent = CAPABLE ? 'WebCodecs ready' : 'Not supported';
if (!CAPABLE) {
  $('unsupported').hidden = false;
  $('drop').setAttribute('aria-disabled', 'true');
  $('drop').classList.add('is-off');
}

/* ------------------------------------------------------------
   Stage machine
   ------------------------------------------------------------ */

const STAGES = ['drop', 'setup', 'run', 'done', 'error'];

let currentStage = 'drop';
function stage(name) {
  currentStage = name;
  for (const s of STAGES) $(`stage-${s}`).hidden = s !== name;
}

/* ------------------------------------------------------------
   Worker
   ------------------------------------------------------------ */

let worker = null;

function ensureWorker() {
  if (worker) return worker;
  worker = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
  worker.onmessage = onWorkerMessage;
  worker.onerror = (e) => fail(e.message || 'The encoder failed to start.');
  return worker;
}

/* ------------------------------------------------------------
   State
   ------------------------------------------------------------ */

let file = null;        // the chosen File
let src = null;         // probe result
let outUrl = null;      // object URL of the last result
let running = false;
let startedAt = 0;
let tick = null;

const opts = {
  mode: 'size',
  targetMB: 16,
  quality: 'medium',
  res: 'auto',
  fps: 'auto',
  audio: 'keep',
  codec: 'avc',
};

/* ------------------------------------------------------------
   File intake
   ------------------------------------------------------------ */

const drop = $('drop');
const fileInput = $('file');

drop.addEventListener('click', (e) => {
  if (drop.classList.contains('is-off')) {
    e.preventDefault();
    return;
  }
  e.preventDefault();
  fileInput.click();
});
drop.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' || e.key === ' ') {
    e.preventDefault();
    if (!drop.classList.contains('is-off')) fileInput.click();
  }
});

fileInput.addEventListener('change', () => {
  if (fileInput.files?.[0]) accept(fileInput.files[0]);
});

for (const ev of ['dragenter', 'dragover']) {
  drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add('is-over'); });
}
for (const ev of ['dragleave', 'drop']) {
  drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.remove('is-over'); });
}

drop.addEventListener('drop', (e) => {
  const f = e.dataTransfer?.files?.[0];
  if (f) accept(f);
});

/* The whole window is a drop target, so a mis-aimed drop still works. */
let dragCounter = 0;
window.addEventListener('dragenter', (e) => {
  e.preventDefault();
  if (running) return;
  dragCounter++;
  if (dragCounter === 1 && currentStage !== 'drop') {
    $('global-drop').classList.add('is-active');
  }
});
window.addEventListener('dragleave', (e) => {
  e.preventDefault();
  if (running) return;
  dragCounter--;
  if (dragCounter === 0) {
    $('global-drop').classList.remove('is-active');
  }
});
window.addEventListener('dragover', (e) => {
  e.preventDefault();
});
window.addEventListener('drop', (e) => {
  e.preventDefault();
  dragCounter = 0;
  $('global-drop').classList.remove('is-active');
  if (running) return;
  const f = e.dataTransfer?.files?.[0];
  if (f) accept(f);
});

document.addEventListener('paste', (e) => {
  if (running) return;
  const f = [...(e.clipboardData?.files ?? [])][0];
  if (f) accept(f);
});

$('change-file').addEventListener('click', () => fileInput.click());

function updateSizeOptionsForFile(fileMB) {
  const presets = document.querySelectorAll('#size-presets .chip-btn');
  let validPresets = [];

  presets.forEach((b) => {
    const mb = Number(b.dataset.mb);
    // Disallow and grey out any preset that is >= source file size
    const isTooBig = mb >= fileMB;
    b.hidden = false;
    b.disabled = isTooBig;
    b.classList.toggle('is-disabled', isTooBig);
    if (!isTooBig) {
      validPresets.push(b);
    } else {
      b.classList.remove('is-on');
    }
  });

  const sizeInput = $('size-mb');
  const maxAllowedMB = Math.max(0.1, Number((fileMB - 0.1).toFixed(1)));
  if (sizeInput) {
    sizeInput.max = String(maxAllowedMB);
  }

  // If current targetMB is >= fileMB, select the largest valid preset, or clamp to 75% of file
  if (opts.targetMB >= fileMB) {
    let best = validPresets.length > 0 ? validPresets[validPresets.length - 1] : null;
    if (best) {
      presets.forEach((x) => x.classList.toggle('is-on', x === best));
      opts.targetMB = Number(best.dataset.mb);
      if (sizeInput) sizeInput.value = String(opts.targetMB);
    } else {
      presets.forEach((x) => x.classList.remove('is-on'));
      opts.targetMB = Math.max(0.5, Number((fileMB * 0.75).toFixed(1)));
      if (sizeInput) sizeInput.value = String(opts.targetMB);
    }
  } else {
    presets.forEach((x) => {
      const mb = Number(x.dataset.mb);
      x.classList.toggle('is-on', !x.disabled && mb === opts.targetMB);
    });
  }
}

function accept(f) {
  if (!CAPABLE) return;
  if (!f.size) return fail('That file is empty.');
  file = f;
  src = null;
  const fileMB = f.size / 1e6;
  updateSizeOptionsForFile(fileMB);

  $('src-name').textContent = f.name;
  $('src-facts').innerHTML =
    '<div class="row"><dt>Reading</dt><dd>…</dd></div>';
  $('plan-read').innerHTML = '<p class="plan-sub">Having a look at it…</p>';
  $('go').setAttribute('aria-disabled', 'true');
  stage('setup');
  ensureWorker().postMessage({ type: 'probe', file: f });
}

/* ------------------------------------------------------------
   Controls
   ------------------------------------------------------------ */

document.querySelectorAll('.tabs .tab').forEach((b) => {
  b.addEventListener('click', () => {
    document.querySelectorAll('.tabs .tab').forEach((x) => {
      const on = x === b;
      x.classList.toggle('is-on', on);
      x.setAttribute('aria-selected', String(on));
    });
    opts.mode = b.dataset.mode;
    $('pane-size').hidden = opts.mode !== 'size';
    $('pane-quality').hidden = opts.mode !== 'quality';
    paintPlan();
  });
});

$('size-presets').addEventListener('click', (e) => {
  const b = e.target.closest('.chip-btn');
  if (!b || b.disabled) return;
  document.querySelectorAll('#size-presets .chip-btn')
    .forEach((x) => x.classList.toggle('is-on', x === b));
  opts.targetMB = Number(b.dataset.mb);
  $('size-mb').value = String(opts.targetMB);
  paintPlan();
});

$('size-mb').addEventListener('input', () => {
  let v = Number($('size-mb').value);
  if (!isFinite(v) || v <= 0) return;
  const fileMB = file ? (file.size / 1e6) : Infinity;
  if (file && v >= fileMB) {
    v = Math.max(0.1, Number((fileMB - 0.1).toFixed(1)));
    $('size-mb').value = String(v);
  }
  opts.targetMB = v;
  document.querySelectorAll('#size-presets .chip-btn')
    .forEach((x) => x.classList.toggle('is-on', !x.disabled && Number(x.dataset.mb) === v));
  paintPlan();
});

const QUALITY_HINTS = {
  'very-low': 'Aggressive. Good enough to show someone what happened, not to keep.',
  'low': 'Small and watchable. Fine for quick shares on a phone screen.',
  'medium': 'A sensible balance — roughly what a streaming service would send you.',
  'high': 'Close to the original at a fraction of the size. A good default for keeping.',
  'very-high': 'Near-transparent. The file will still be much smaller, just not tiny.',
};

$('quality-steps').addEventListener('click', (e) => {
  const b = e.target.closest('.step');
  if (!b) return;
  document.querySelectorAll('#quality-steps .step')
    .forEach((x) => x.classList.toggle('is-on', x === b));
  opts.quality = b.dataset.q;
  $('quality-hint').textContent = QUALITY_HINTS[opts.quality];
  paintPlan();
});

for (const [id, key] of [['res', 'res'], ['fps', 'fps'], ['audio', 'audio'], ['codec', 'codec']]) {
  $(id).addEventListener('change', () => {
    opts[key] = $(id).value;
    if (key === 'codec') paintCodecWarning();
    paintPlan();
  });
}

function paintCodecWarning() {
  const w = $('codec-warn');
  if (opts.codec === 'hevc') {
    w.hidden = false;
    w.textContent = 'H.265 makes smaller files but will not play everywhere — ' +
      'Windows and some Android devices need an extra codec. Pick H.264 if you are unsure.';
  } else if (opts.codec === 'av1') {
    w.hidden = false;
    w.textContent = 'AV1 is the smallest option but the slowest to encode, and older ' +
      'phones cannot play it. Most messaging apps expect H.264.';
  } else if (opts.codec === 'vp9') {
    w.hidden = false;
    w.textContent = 'VP9 inside an MP4 plays in modern browsers but is unusual for ' +
      'messaging apps. Pick H.264 if the file is going to someone else.';
  } else {
    w.hidden = true;
  }
}

/* ------------------------------------------------------------
   Facts + plan readout
   ------------------------------------------------------------ */

function paintFacts() {
  const rows = [
    ['Size', fmtBytes(src.size)],
    ['Duration', fmtTime(src.duration)],
    ['Resolution', `${src.width} × ${src.height}`],
    ['Frame rate', src.fps ? `${src.fps.toFixed(src.fps % 1 ? 2 : 0)} fps` : '—'],
    ['Video', niceCodec(src.codec)],
    ['Bitrate', fmtRate(src.videoBitrate)],
    ['Audio', src.audio
      ? `${niceCodec(src.audio.codec)}${src.audio.channels ? ` · ${src.audio.channels}ch` : ''}`
      : 'none'],
  ];
  $('src-facts').innerHTML = rows
    .map(([k, v]) => `<div class="row"><dt>${k}</dt><dd>${v}</dd></div>`)
    .join('');
}

function paintPlan() {
  if (!src) return;
  const plan = computePlan(src, opts, opts.codec);
  const { width, height } = plan.dims;
  const fpsTxt = plan.fps ? `${plan.fps} fps` : `${Math.round(src.fps || 0)} fps`;

  const bits = [
    `${width} × ${height}`,
    fpsTxt,
    CODEC_LABEL[opts.codec] ?? opts.codec,
    plan.keepAudio ? 'audio kept' : 'no audio',
  ];

  if (opts.mode === 'size') {
    const already = src.size <= plan.targetBytes;
    $('plan-read').innerHTML = `
      <p class="plan-line">
        <span class="from">${fmtBytes(src.size)}</span>
        <span class="arrow">→</span>
        <span class="to">under ${fmtBytes(plan.targetBytes)}</span>
      </p>
      <p class="plan-sub mono">${bits.join(' · ')} · ${fmtRate(plan.videoBps)}</p>
      ${already ? '<p class="plan-sub mono">Already fits — but it can still get smaller.</p>' : ''}
    `;
  } else {
    $('plan-read').innerHTML = `
      <p class="plan-line">
        <span class="from">${fmtBytes(src.size)}</span>
        <span class="arrow">→</span>
        <span class="to">${width} × ${height}</span>
      </p>
      <p class="plan-sub mono">${opts.quality.replace('-', ' ')} quality · ${bits.slice(1).join(' · ')}</p>
    `;
  }
  $('go').removeAttribute('aria-disabled');
}

/* ------------------------------------------------------------
   Progress meter
   ------------------------------------------------------------ */

const METER_CELLS = 40;
const meter = $('meter');
meter.innerHTML = Array.from({ length: METER_CELLS }, () => '<i></i>').join('');
const cells = [...meter.children];

function paintMeter(p) {
  const lit = Math.round(p * METER_CELLS);
  cells.forEach((c, i) => c.classList.toggle('on', i < lit));
  meter.setAttribute('aria-valuenow', String(Math.round(p * 100)));
}

/* ------------------------------------------------------------
   Preview canvas
   ------------------------------------------------------------ */

let previewCtx = null;

function drawFrame(bitmap) {
  try {
    const canvas = $('preview');
    if (canvas.width !== bitmap.width || canvas.height !== bitmap.height) {
      canvas.width = bitmap.width;
      canvas.height = bitmap.height;
      canvas.style.aspectRatio = `${bitmap.width} / ${bitmap.height}`;
    }
    if (!previewCtx) previewCtx = canvas.getContext('bitmaprenderer');
    previewCtx.transferFromImageBitmap(bitmap);
  } catch {
    bitmap.close?.();
  }
}

/* ------------------------------------------------------------
   Run
   ------------------------------------------------------------ */

$('go').addEventListener('click', () => {
  if (!src || !file || running) return;
  running = true;
  startedAt = performance.now();
  paintMeter(0);
  $('st-pct').textContent = '0%';
  $('st-time').textContent = '0:00';
  $('st-elapsed').textContent = '0:00';
  $('st-speed').textContent = '—';
  $('run-pass').textContent = '';
  $('cancel').removeAttribute('aria-disabled');
  if (src?.width && src?.height) {
    $('preview').style.aspectRatio = `${src.width} / ${src.height}`;
  }
  stage('run');

  clearInterval(tick);
  tick = setInterval(() => {
    $('st-elapsed').textContent = fmtTime((performance.now() - startedAt) / 1000);
  }, 250);

  ensureWorker().postMessage({ type: 'run', file, opts: { ...opts, src } });
});

$('cancel').addEventListener('click', () => {
  if (!running) return;
  $('cancel').setAttribute('aria-disabled', 'true');
  worker?.postMessage({ type: 'cancel' });
});

$('again').addEventListener('click', reset);
$('err-back').addEventListener('click', reset);
$('retry')?.addEventListener('click', retryFile);
$('err-retry')?.addEventListener('click', retryFile);

function retryFile() {
  if (!file) return reset();
  running = false;
  clearInterval(tick);
  if (outUrl) { URL.revokeObjectURL(outUrl); outUrl = null; }
  $('result-video').removeAttribute('src');
  stage('setup');
  paintFacts();
  paintPlan();
}

function reset() {
  running = false;
  clearInterval(tick);
  if (outUrl) { URL.revokeObjectURL(outUrl); outUrl = null; }
  $('result-video').removeAttribute('src');
  file = null;
  src = null;
  fileInput.value = '';
  stage('drop');
}

function fail(message) {
  running = false;
  clearInterval(tick);
  $('err-msg').textContent = message;
  stage('error');
}

/* ------------------------------------------------------------
   Worker messages
   ------------------------------------------------------------ */

function onWorkerMessage(e) {
  const m = e.data;

  switch (m.type) {
    case 'probed': {
      src = m.info;
      paintFacts();
      paintCodecWarning();
      paintPlan();
      break;
    }

    case 'pass': {
      $('run-pass').textContent = m.of > 1 && m.pass > 1
        ? `Correcting · pass ${m.pass}` : '';
      break;
    }

    case 'retry': {
      $('run-pass').textContent =
        `${fmtBytes(m.was)} — over the limit, re-encoding tighter`;
      paintMeter(0);
      break;
    }

    case 'progress': {
      paintMeter(m.p);
      $('st-pct').textContent = `${Math.round(m.p * 100)}%`;
      $('st-time').textContent = fmtTime(m.t);
      const wall = (performance.now() - startedAt) / 1000;
      if (wall > 0.6 && m.t > 0) {
        $('st-speed').textContent = `${(m.t / wall).toFixed(1)}×`;
      }
      break;
    }

    case 'frame': {
      drawFrame(m.bitmap);
      break;
    }

    case 'note': {
      const w = $('codec-warn');
      w.hidden = false;
      w.textContent = m.message;
      break;
    }

    case 'done': {
      finish(m);
      break;
    }

    case 'canceled': {
      running = false;
      clearInterval(tick);
      stage('setup');
      break;
    }

    case 'error': {
      fail(m.message);
      break;
    }
  }
}

/* ------------------------------------------------------------
   Result
   ------------------------------------------------------------ */

function finish(m) {
  running = false;
  clearInterval(tick);
  paintMeter(1);

  const blob = new Blob([m.buffer], { type: 'video/mp4' });
  if (outUrl) URL.revokeObjectURL(outUrl);
  outUrl = URL.createObjectURL(blob);

  const saved = src.size - m.size;
  const times = m.size > 0 ? src.size / m.size : 0;
  const pct = src.size > 0 ? Math.round((saved / src.size) * 100) : 0;

  $('ba-before').textContent = fmtBytes(src.size);
  $('ba-before-meta').textContent =
    `${src.width}×${src.height} · ${niceCodec(src.codec)}`;
  $('ba-after').textContent = fmtBytes(m.size);
  $('ba-after-meta').textContent =
    `${m.width}×${m.height} · ${m.codecLabel}${m.hasAudio ? '' : ' · muted'}`;

  const ratio = $('ratio');
  if (saved > 0) {
    ratio.className = 'tag tag--win';
    ratio.textContent = `${times.toFixed(1)}× smaller — ${pct}% gone`;
  } else {
    ratio.className = 'tag tag--warn';
    ratio.textContent = 'No smaller than it started';
  }

  $('result-passes').textContent =
    m.passes > 1 ? `${m.passes} passes` : '1 pass';

  const notes = [];
  if (m.overTarget) {
    notes.push(
      `This one stubbornly refused to get under ${fmtBytes(m.targetBytes)} — it is ` +
      `either quite long or very busy. Try a smaller resolution, fewer frames per ` +
      `second, or dropping the sound, and it should come down.`
    );
  }
  if (saved <= 0) {
    notes.push(
      'Turns out this file was already squeezed about as well as it can be, so there ' +
      'was nothing left to win. Stick with your original.'
    );
  }
  notes.push(
    'Squeezing throws away a little detail on purpose, so give this a quick watch ' +
    'before you delete the original.'
  );
  $('result-note').textContent = notes.join(' ');

  const v = $('result-video');
  v.src = outUrl;

  const base = (src?.name || file?.name || 'video').replace(/\.[^.]+$/, '');
  const dl = $('download');
  dl.href = outUrl;
  dl.download = `${base}-shrinkray.mp4`;
  dl.textContent = m.overTarget ? 'Save Anyway' : 'Save it';

  incrementCounter();
  stage('done');
}

/* ------------------------------------------------------------
   CounterAPI (v2)
   Tracks total anonymous compression count across the community.
   ------------------------------------------------------------ */

const COUNTER_CONFIG = {
  workspace: 'pixelabs',
  name: 'shrinkray',
  apiBase: 'https://api.counterapi.dev/v2',
};

const CACHE_KEY = 'sr_cached_count';
let currentCount = 0;

function renderCount(n) {
  if (typeof n !== 'number' || isNaN(n)) return;
  currentCount = n;
  try { sessionStorage.setItem(CACHE_KEY, String(n)); } catch {}
  const str = n.toLocaleString();
  const heroBadge = $('hero-counter');
  const heroVal = $('counter-val');
  const footBadge = $('foot-counter');
  const footVal = $('foot-counter-val');
  const offlinePill = $('counter-offline-pill');
  if (offlinePill) offlinePill.remove();

  if (heroVal) heroVal.textContent = str;
  if (heroBadge) {
    heroBadge.style.opacity = '1';
    heroBadge.hidden = false;
  }
  if (footBadge && footVal) {
    footVal.textContent = str;
    footBadge.hidden = false;
  }
}

function renderOffline() {
  const heroBadge = $('hero-counter');
  const heroVal = $('counter-val');
  const heroTitle = $('counter-title-wrap');
  if (heroVal && !currentCount) {
    heroVal.textContent = '—';
  }
  if (heroTitle && !$('counter-offline-pill')) {
    const pill = document.createElement('span');
    pill.id = 'counter-offline-pill';
    pill.className = 'counter-offline';
    pill.textContent = '(currently offline)';
    heroTitle.appendChild(pill);
  }
  if (heroBadge) {
    heroBadge.style.opacity = '1';
    heroBadge.hidden = false;
  }
}

async function fetchCounter() {
  if (!navigator.onLine) {
    renderOffline();
    return;
  }
  try {
    const res = await fetch(`${COUNTER_CONFIG.apiBase}/${COUNTER_CONFIG.workspace}/${COUNTER_CONFIG.name}?_t=${Date.now()}`, {
      cache: 'no-store'
    });
    if (res.ok) {
      const json = await res.json();
      if (typeof json?.data?.up_count === 'number') {
        renderCount(json.data.up_count);
        return;
      }
    }
    renderOffline();
  } catch {
    renderOffline();
  }
}

async function incrementCounter() {
  currentCount++;
  renderCount(currentCount);
  try {
    const res = await fetch(`${COUNTER_CONFIG.apiBase}/${COUNTER_CONFIG.workspace}/${COUNTER_CONFIG.name}/up?_t=${Date.now()}`, {
      cache: 'no-store'
    });
    if (res.ok) {
      const json = await res.json();
      if (typeof json?.data?.up_count === 'number' && json.data.up_count > currentCount) {
        renderCount(json.data.up_count);
      }
    }
  } catch {}
}

// Instantaneous synchronous display if cached from this session
try {
  const cached = sessionStorage.getItem(CACHE_KEY);
  if (cached && !isNaN(Number(cached))) {
    renderCount(Number(cached));
  }
} catch {}

window.addEventListener('online', fetchCounter);
window.addEventListener('offline', renderOffline);

fetchCounter();
