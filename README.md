# Shrinkray <img src="assets/raygun.svg" width="32" height="32" alt="Shrinkray Gun" align="center" />

"Sorry, that video is too large to send." Drop it here instead.

Shrinkray compresses videos **entirely inside your browser** — holiday clips, camera-roll videos, screen recordings, or anything else you need to share. Nothing is uploaded to any server.

> A 232 MB, 28-second 4K screen recording → **15.1 MB in 8.3 seconds**, comfortably under a 16 MB limit.

## 🚀 Features

- **Hardware-Accelerated**: Driven by the browser's native [WebCodecs](https://developer.mozilla.org/en-US/docs/Web/API/WebCodecs_API) API on your device's GPU/silicon for lightning-fast encoding.
- **100% Client-Side & Private**: Your videos never leave your machine. Processing happens locally in memory via a Web Worker. No video data or frames are ever uploaded or stored.
- **Target Size Matching**: Tell Shrinkray what size limit you need (e.g. Discord, WhatsApp, email) and it automatically calculates bitrates and resolutions to ensure your output fits.
- **Works Offline**: Once loaded, Shrinkray operates completely without an internet connection.
- **Powered by [Mediabunny](https://mediabunny.dev)**: Built on top of Mediabunny by Vanilagy for robust demuxing, decoding, scaling, and muxing.

## ⚙️ How It Works

| Layer | What it does |
|---|---|
| [WebCodecs](https://developer.mozilla.org/en-US/docs/Web/API/WebCodecs_API) | Hands encode/decode directly to device hardware acceleration |
| [Mediabunny](https://mediabunny.dev) | Demux → decode → scale → encode → mux pipeline |
| Web Worker | Runs the compression pipeline off the main thread for smooth UI responsiveness |
| GitHub Pages | Pure static site hosting with zero backend infrastructure |

## 💻 Running Locally

Shrinkray is a zero-build static web app. You can clone and run it with any local static HTTP server:

```bash
# Using python:
python3 -m http.server 8080

# Or using npx serve:
npx serve .
```

Then visit `http://localhost:8080` in your browser.

## 🌐 Browser Support

Shrinkray requires a modern browser supporting the **WebCodecs** API:
- Google Chrome / Chromium / Brave / Edge (v94+)
- Apple Safari (v16.4+)
- Mozilla Firefox (v130+)

## 📄 License

- **Shrinkray**: MIT — see [`LICENSE`](LICENSE).
- **Mediabunny**: Mozilla Public License 2.0 ([`vendor/mediabunny.LICENSE`](vendor/mediabunny.LICENSE)).
- **Fonts**: SIL Open Font License 1.1 ([`assets/fonts/`](assets/fonts/)).

---

Built with 💜 by [PixeLabs](https://pixelabs.net).
