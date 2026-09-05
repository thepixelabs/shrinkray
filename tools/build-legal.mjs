#!/usr/bin/env node
/**
 * Renders legal/*.md into static HTML pages at the repo root.
 *
 *   npm run legal
 *
 * The output is committed, so the published site needs no build step
 * and no client-side markdown renderer - the terms stay readable with
 * JavaScript switched off, which for legal copy is the point.
 */
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { marked } from 'marked';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

const PAGES = [
  { md: 'legal/terms.md',   out: 'terms.html',   title: 'Terms & EULA' },
  { md: 'legal/privacy.md', out: 'privacy.html', title: 'Privacy Notice' },
];

const page = (title, body) => `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; font-src 'self'; img-src 'self' data:; connect-src 'none'; form-action 'none'; base-uri 'none'">
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
  <title>${title} · Shrinkray</title>
  <meta name="description" content="${title} for Shrinkray, the in-browser video compressor.">
  <meta name="theme-color" content="#0d0e14">
  <meta name="robots" content="index, follow">
  <link rel="icon" href="assets/favicon.svg" type="image/svg+xml">
  <link rel="preload" as="font" href="assets/fonts/jost-latin-variable.woff2" type="font/woff2" crossorigin>
  <link rel="preload" as="font" href="assets/fonts/jetbrains-mono-latin-variable.woff2" type="font/woff2" crossorigin>
  <link rel="stylesheet" href="css/style.css">
</head>
<body>

<div class="bg-aurora" aria-hidden="true">
  <div class="blob blob-a"></div>
  <div class="blob blob-b"></div>
  <div class="blob blob-c"></div>
</div>

<header class="site-head">
  <div class="wrap">
    <a class="brand" href="./">
      <span class="brand-icon" aria-hidden="true">
        <!-- Exquisite Neon Duotone Diamond Icon -->
        <svg viewBox="0 0 24 24" fill="none" width="24" height="24" style="filter: drop-shadow(0 0 8px rgba(0,240,255,0.6));">
          <path d="M12 2L2 12L12 22L22 12L12 2Z" stroke="var(--cyan)" stroke-width="1.5" stroke-linejoin="round"/>
          <path d="M12 6L6 12L12 18L18 12L12 6Z" fill="url(#brand-grad)" />
          <defs>
            <linearGradient id="brand-grad" x1="12" y1="6" x2="12" y2="18" gradientUnits="userSpaceOnUse">
              <stop offset="0%" stop-color="var(--pink)" />
              <stop offset="100%" stop-color="var(--violet)" />
            </linearGradient>
          </defs>
        </svg>
      </span>
      <span class="brand-name" aria-label="Shrinkray"><span class="d-shrink">SHRINK</span><span class="d-ray">RAY</span></span>
    </a>
    <nav class="site-nav">
      <a href="./#why">Why so big?</a>
      <a href="./#local">Where it goes</a>
      
      <!-- GitHub Icon -->
      <a href="https://github.com/thepixelabs/shrinkray" target="_blank" rel="noopener" class="icon-link is-cta" aria-label="GitHub Repository" title="Source Code">
        <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor">
          <path d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12"/>
        </svg>
      </a>

      <!-- Pixelabs Colorful Icon -->
      <a href="https://pixelabs.net" target="_blank" rel="noopener" class="icon-link is-cta pixelabs-link" aria-label="Pixelabs Website" title="Pixelabs">
        <svg viewBox="0 0 24 24" width="20" height="20" fill="none" style="filter: drop-shadow(0 0 8px rgba(0,240,255,0.8));">
          <defs>
            <linearGradient id="pxl-grad-2" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stop-color="var(--cyan)" />
              <stop offset="50%" stop-color="var(--violet)" />
              <stop offset="100%" stop-color="var(--pink)" />
            </linearGradient>
          </defs>
          <path d="M12 2L2 12l10 10 10-10L12 2z" stroke="url(#pxl-grad-2)" stroke-width="2.5" stroke-linejoin="round" fill="rgba(190,72,224,0.1)"/>
          <circle cx="12" cy="12" r="3" fill="var(--acid)" filter="drop-shadow(0 0 6px var(--acid))"/>
        </svg>
      </a>
    </nav>
  </div>
</header>

<main class="section">
  <div class="wrap">
    <article class="legal">
${body}
    </article>
  </div>
</main>

<footer class="site-foot">
  <div class="wrap foot-inner">
    <p class="mono">Built with <span class="heart-pixel">💜</span> by <a href="https://pixelabs.net" target="_blank" rel="noopener">PixeLabs</a></p>
    <nav class="foot-links mono">
      <a href="./">Shrink</a>
      <a href="terms.html">Terms</a>
      <a href="privacy.html">Privacy</a>
      <a href="https://github.com/thepixelabs/shrinkray" target="_blank" rel="noopener">GitHub</a>
      <a href="https://pixelabs.net" target="_blank" rel="noopener">PixeLabs</a>
      <a href="https://github.com/thepixelabs/shrinkray/blob/master/LICENSE" target="_blank" rel="noopener">MIT</a>
    </nav>
  </div>
</footer>
</body>
</html>
`;

marked.setOptions({ mangle: false, headerIds: true });

let built = 0;
for (const p of PAGES) {
  let md;
  try {
    md = await readFile(join(ROOT, p.md), 'utf8');
  } catch {
    console.warn(`skip ${p.md} (not found)`);
    continue;
  }
  const html = marked.parse(md);
  await writeFile(join(ROOT, p.out), page(p.title, html), 'utf8');
  console.log(`${p.md} → ${p.out}  (${(html.length / 1024).toFixed(1)} KB)`);
  built++;
}

if (!built) {
  console.error('nothing built - are the markdown sources present?');
  process.exit(1);
}
