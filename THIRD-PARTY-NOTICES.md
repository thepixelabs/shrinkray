# Third-party notices

Shrinkray redistributes the components below. Each is governed by its own
licence; nothing in Shrinkray's own MIT licence overrides them.

---

## Mediabunny

- **Used for:** reading, decoding, re-encoding and writing media files, driving
  the browser's WebCodecs API.
- **Version redistributed:** 1.55.6
- **File in this repository:** `vendor/mediabunny.min.mjs`
- **Licence:** Mozilla Public License 2.0 — full text at `vendor/mediabunny.LICENSE`
- **Copyright:** © 2026-present, Vanilagy and contributors
- **Project home:** <https://mediabunny.dev>
- **Source code:** <https://github.com/Vanilagy/mediabunny>
- **Source for this exact version:**
  <https://github.com/Vanilagy/mediabunny/releases/tag/v1.55.6>
  (also available from npm: `npm pack mediabunny@1.55.6`)

### Modifications

**None.** `vendor/mediabunny.min.mjs` is the unmodified `dist/bundles/mediabunny.min.mjs`
build as published to npm for version 1.55.6.

> This notice is provided to satisfy Mozilla Public License 2.0 §3.2 — recipients
> of this software in executable form are informed of the licence and told where
> to obtain the corresponding Source Code Form.

---

## Jost

- **Used for:** display, headings, and interface typeface.
- **Files:** `assets/fonts/jost-latin-variable.woff2`
- **Licence:** SIL Open Font License 1.1 — full text at `assets/fonts/Jost-OFL.txt`
- **Copyright:** © 2020 The Jost Project Authors
- **Source:** <https://github.com/indestructibletype/Jost>

Subsetted to the Latin range and converted to WOFF2 variable font for the web; the glyph
outlines are unmodified. Redistributed under the OFL, which permits this. The
font is not sold, and "Jost" is not used to name a modified version.

---

## JetBrains Mono

- **Used for:** numeric readouts, code, badges, labels and interface chrome.
- **Files:** `assets/fonts/jetbrains-mono-latin-variable.woff2`
- **Licence:** SIL Open Font License 1.1 — full text at `assets/fonts/JetBrainsMono-OFL.txt`
- **Copyright:** © 2020 The JetBrains Mono Project Authors
- **Source:** <https://github.com/JetBrains/JetBrainsMono>

Subsetted to the Latin range and converted to WOFF2 variable font for the web; the glyph
outlines are unmodified.

---

## Build-time only — not redistributed

These are development dependencies. They are **not** part of the published site
and are not shipped to any user.

| Package | Licence | Used for |
|---|---|---|
| `marked` | MIT | Rendering `legal/*.md` into `terms.html` / `privacy.html` |

---

## Codecs

Shrinkray does not contain, redistribute or implement any video or audio codec.
It calls the **browser's** WebCodecs implementation, which is supplied and
licensed by the browser vendor.

H.264/AVC, H.265/HEVC and AAC are covered by patent pools. No patent licence is
granted by Shrinkray, its MIT licence, or the operator. See section 9 of
[`legal/terms.md`](legal/terms.md).
