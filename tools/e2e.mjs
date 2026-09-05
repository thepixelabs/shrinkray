#!/usr/bin/env node
/**
 * End-to-end test: drives real Google Chrome over the DevTools
 * Protocol, feeds a video into the page's file input, runs a real
 * compression, and reports what came out.
 *
 *   node tools/e2e.mjs <video-file> [url] [targetMB]
 *
 * Real Chrome rather than a bundled Chromium because WebCodecs needs
 * the full proprietary codec set (H.264/H.265) to be meaningful.
 */
import { spawn } from 'node:child_process';
import { statSync } from 'node:fs';
import { resolve } from 'node:path';

const [videoArg, urlArg, targetArg] = process.argv.slice(2);
if (!videoArg) {
  console.error('usage: node tools/e2e.mjs <video-file> [url] [targetMB]');
  process.exit(1);
}

const VIDEO = resolve(videoArg);
const URL_ = urlArg || 'http://127.0.0.1:8788/';
const TARGET_MB = targetArg ? Number(targetArg) : null;
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const port = 9400 + Math.floor(Math.random() * 400);

const chrome = spawn(CHROME, [
  '--headless=new',
  '--no-first-run', '--no-default-browser-check', '--hide-scrollbars',
  '--autoplay-policy=no-user-gesture-required',
  `--remote-debugging-port=${port}`,
  '--window-size=1440,1800',
  `--user-data-dir=/tmp/shrinkray-e2e-${port}`,
  'about:blank',
], { stdio: 'ignore' });

let ws;
let msgId = 0;
const pending = new Map();
const logs = [];

function send(method, params = {}) {
  const id = ++msgId;
  ws.send(JSON.stringify({ id, method, params }));
  return new Promise((res, rej) => {
    pending.set(id, { res, rej });
    setTimeout(() => {
      if (pending.has(id)) { pending.delete(id); rej(new Error(`${method} timed out`)); }
    }, 600_000);
  });
}

const evaluate = async (expr) => {
  const r = await send('Runtime.evaluate', {
    expression: expr, returnByValue: true, awaitPromise: true,
  });
  if (r.exceptionDetails) {
    throw new Error(r.exceptionDetails.exception?.description ?? 'evaluate threw');
  }
  return r.result?.value;
};

async function targets() {
  const r = await fetch(`http://127.0.0.1:${port}/json/list`);
  return r.json();
}

async function main() {
  // wait for Chrome's debugging endpoint
  let list = null;
  for (let i = 0; i < 100; i++) {
    try {
      list = (await targets()).filter((t) => t.type === 'page');
      if (list.length) break;
    } catch {}
    await sleep(100);
  }
  if (!list?.length) throw new Error('Chrome did not start');

  ws = new WebSocket(list[0].webSocketDebuggerUrl);
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });

  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) {
      const { res, rej } = pending.get(m.id);
      pending.delete(m.id);
      m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result);
    } else if (m.method === 'Runtime.consoleAPICalled') {
      const text = (m.params.args || [])
        .map((a) => a.value ?? a.description ?? a.type).join(' ');
      logs.push(`[${m.params.type}] ${text}`);
    } else if (m.method === 'Runtime.exceptionThrown') {
      logs.push(`[uncaught] ${m.params.exceptionDetails.exception?.description
        ?? m.params.exceptionDetails.text}`);
    }
  };

  await send('Runtime.enable');
  await send('Page.enable');
  await send('DOM.enable');

  console.log(`→ ${URL_}`);
  await send('Page.navigate', { url: URL_ });
  await sleep(2500);

  const badge = await evaluate(`document.getElementById('engine-badge').textContent`);
  console.log(`   engine: ${badge}`);
  if (!/ready/i.test(badge)) throw new Error(`WebCodecs unavailable: ${badge}`);

  // feed the file in
  const src = statSync(VIDEO);
  console.log(`→ feeding ${VIDEO} (${(src.size / 1e6).toFixed(1)} MB)`);
  const doc = await send('DOM.getDocument');
  const node = await send('DOM.querySelector', {
    nodeId: doc.root.nodeId, selector: '#file',
  });
  await send('DOM.setFileInputFiles', { nodeId: node.nodeId, files: [VIDEO] });

  // wait for the probe to land
  let facts = null;
  for (let i = 0; i < 200; i++) {
    facts = await evaluate(`(() => {
      const el = document.getElementById('src-facts');
      const go = document.getElementById('go');
      if (!el || el.textContent.includes('…')) return null;
      if (go.getAttribute('aria-disabled') === 'true') return null;
      return {
        facts: [...el.querySelectorAll('.row')].map(r =>
          r.querySelector('dt').textContent + '=' + r.querySelector('dd').textContent),
        plan: document.getElementById('plan-read').textContent.replace(/\\s+/g,' ').trim(),
      };
    })()`);
    if (facts) break;
    await sleep(150);
  }
  if (!facts) throw new Error('probe never completed');
  console.log('   probed: ' + facts.facts.join(', '));
  console.log('   plan:   ' + facts.plan);

  if (TARGET_MB) {
    await evaluate(`(() => {
      const i = document.getElementById('size-mb');
      i.value = '${TARGET_MB}';
      i.dispatchEvent(new Event('input', {bubbles:true}));
    })()`);
    await sleep(200);
  }

  console.log('→ encoding…');
  const t0 = Date.now();
  await evaluate(`document.getElementById('go').click()`);

  let done = null;
  let lastPct = -1;
  for (let i = 0; i < 4000; i++) {
    const s = await evaluate(`(() => {
      if (!document.getElementById('stage-done').hidden) {
        return { ok: true,
          before: document.getElementById('ba-before').textContent,
          after:  document.getElementById('ba-after').textContent,
          ameta:  document.getElementById('ba-after-meta').textContent,
          ratio:  document.getElementById('ratio').textContent,
          passes: document.getElementById('result-passes').textContent,
          note:   document.getElementById('result-note').textContent,
          dl:     document.getElementById('download').getAttribute('download'),
          vsrc:   !!document.getElementById('result-video').src,
        };
      }
      if (!document.getElementById('stage-error').hidden) {
        return { ok: false, err: document.getElementById('err-msg').textContent };
      }
      return { pct: document.getElementById('st-pct').textContent,
               speed: document.getElementById('st-speed').textContent };
    })()`);

    if (s.ok === true) { done = s; break; }
    if (s.ok === false) throw new Error('page reported: ' + s.err);
    if (s.pct && s.pct !== lastPct) {
      lastPct = s.pct;
      process.stdout.write(`\r   ${s.pct}  ${s.speed}   `);
    }
    await sleep(250);
  }
  process.stdout.write('\n');
  if (!done) throw new Error('encode never finished');

  const secs = ((Date.now() - t0) / 1000).toFixed(1);
  console.log(`\n✓ finished in ${secs}s`);
  console.log(`   ${done.before}  →  ${done.after}   (${done.ameta})`);
  console.log(`   ${done.ratio}  ·  ${done.passes}`);
  console.log(`   download: ${done.dl}   preview wired: ${done.vsrc}`);
  console.log(`   note: ${done.note}`);

  await send('Page.captureScreenshot', { format: 'png' })
    .then(async (r) => {
      const { writeFile } = await import('node:fs/promises');
      await writeFile('/tmp/shrinkray-e2e.png', Buffer.from(r.data, 'base64'));
      console.log('   screenshot: /tmp/shrinkray-e2e.png');
    }).catch(() => {});

  const bad = logs.filter((l) => /uncaught|\[error\]/i.test(l));
  if (bad.length) {
    console.log('\n! console problems:');
    bad.forEach((l) => console.log('   ' + l));
  } else {
    console.log('   console: clean');
  }
}

main()
  .then(() => { chrome.kill(); process.exit(0); })
  .catch((e) => {
    console.error('\n✗ ' + e.message);
    if (logs.length) {
      console.error('\nconsole:');
      logs.slice(-25).forEach((l) => console.error('  ' + l));
    }
    chrome.kill();
    process.exit(1);
  });
