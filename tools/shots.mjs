#!/usr/bin/env node
/**
 * Screenshots each stage of the interface.
 *
 *   node tools/shots.mjs <video-file> [url] [outdir]
 *
 * Does not run an encode — it stops at the setup stage, so it is
 * quick enough to use while iterating on the design.
 */
import { spawn } from 'node:child_process';
import { writeFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';

const [videoArg, urlArg, outArg] = process.argv.slice(2);
const URL_ = urlArg || 'http://127.0.0.1:8788/';
const OUT = outArg || '/tmp/shrinkray-shots';
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const port = 9800 + Math.floor(Math.random() * 300);

const chrome = spawn(CHROME, [
  '--headless=new', '--no-first-run', '--no-default-browser-check',
  '--hide-scrollbars', `--remote-debugging-port=${port}`,
  '--window-size=1440,1250', `--user-data-dir=/tmp/shrinkray-shots-${port}`,
  'about:blank',
], { stdio: 'ignore' });

let ws, id = 0;
const pending = new Map();

const send = (method, params = {}) => {
  const n = ++id;
  ws.send(JSON.stringify({ id: n, method, params }));
  return new Promise((res, rej) => {
    pending.set(n, { res, rej });
    setTimeout(() => { if (pending.delete(n)) rej(new Error(method + ' timeout')); }, 60_000);
  });
};

const evaluate = (e) =>
  send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true })
    .then((r) => r.result?.value);

async function shot(name) {
  const r = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true });
  await writeFile(`${OUT}/${name}.png`, Buffer.from(r.data, 'base64'));
  console.log(`   ${OUT}/${name}.png`);
}

async function main() {
  await mkdir(OUT, { recursive: true });

  let list;
  for (let i = 0; i < 100; i++) {
    try {
      list = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json())
        .filter((t) => t.type === 'page');
      if (list.length) break;
    } catch {}
    await sleep(100);
  }

  ws = new WebSocket(list[0].webSocketDebuggerUrl);
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) {
      const { res, rej } = pending.get(m.id);
      pending.delete(m.id);
      m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result);
    }
  };

  await send('Runtime.enable');
  await send('Page.enable');
  await send('DOM.enable');

  await send('Page.navigate', { url: URL_ });
  await sleep(2200);

  console.log('→ drop stage');
  await shot('01-drop');

  if (videoArg) {
    console.log('→ setup stage');
    const doc = await send('DOM.getDocument');
    const node = await send('DOM.querySelector', { nodeId: doc.root.nodeId, selector: '#file' });
    await send('DOM.setFileInputFiles', { nodeId: node.nodeId, files: [resolve(videoArg)] });

    for (let i = 0; i < 160; i++) {
      const ready = await evaluate(
        `document.getElementById('go')?.getAttribute('aria-disabled') !== 'true'
         && !document.getElementById('stage-setup').hidden`);
      if (ready) break;
      await sleep(150);
    }
    await sleep(400);
    await shot('02-setup');

    await evaluate(`document.querySelector('[data-mode="quality"]').click()`);
    await sleep(400);
    await shot('03-quality-mode');
  }
}

main()
  .then(() => { chrome.kill(); process.exit(0); })
  .catch((e) => { console.error('✗ ' + e.message); chrome.kill(); process.exit(1); });
