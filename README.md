# RexMedia Studio

**Creator metadata and public-media toolkit — by XboyRex**

RexMedia Studio is a responsive, static website for reading metadata that is exposed on public YouTube and Instagram pages. It has a no-build frontend plus a small allow-listed Cloudflare Worker. It does not require YouTube Data API keys, Instagram credentials, a database or a server that you have to keep running.

## Features

### YouTube
- Read public video title, description, channel/author, visible view count and duration when exposed.
- Extract hashtags present in the title and description.
- Extract YouTube creator tags (`videoDetails.keywords`) when the public watch page includes them.
- Offer common thumbnail sizes (maxres, SD, HQ and MQ) for download.
- Attempt to show five comments sorted by visible like counts, and a visible like count when present in page data.
- Copy title, description, hashtags, tags and individual comments.

### Instagram
- Accept public post, Reel, Reels, TV and story/highlight URLs.
- Attempt to extract the caption, hashtags, creator name and media exposed in public page data.
- Support carousel items when the public page makes them available.
- Offer public images/videos and cover previews for download.
- Show track title/artist details when available and offer a direct audio download only if a separate audio URL is actually exposed.
- No profile-visit shortcut is included.

### Workspace
- Responsive desktop/mobile layout, custom SVG icon sprite, light/dark theme toggle, local recent links and one-click copy buttons.
- No analytics, tracking pixel, account login, API-key input or database. Recent links are stored only in the browser's `localStorage` and can be cleared.

## Honest limitations

This is a **best-effort public-page parser**, not an official integration. The Instagram public-product lookup structure is adapted from the open-source [InstaDownload project by Orang-Studio](https://github.com/Orang-Studio/InstaDownload), supplied as the reference ZIP for this build; its upstream project is GPLv3, so this package is also distributed under GPL-3.0-only. YouTube and Instagram can change markup, withhold metadata, return a consent page or rate-limit requests. There is no guarantee that every public link will return every field.

- YouTube creator tags, likes and comments may not be included in the HTML. The tool does not invent missing values.
- Instagram's public webpage usually exposes a Reel as a video file, not a separate audio-only file. Since this project intentionally does not transcode media, it can download audio-only only when the source exposes a distinct audio URL. It will not rename an MP4 file to `.mp3`.
- Instagram stories/highlights are frequently login-gated. The tool only tries media made available to the public request and does not log in, access private accounts, or bypass access controls.
- A thumbnail or direct media download can expire, be blocked, or be refused by the source.
- Do not download or reuse content without permission from the rights holder. Follow the terms of the source platform: [YouTube Terms](https://www.youtube.com/t/terms) and [Instagram Terms](https://help.instagram.com/581066165581870).

## Architecture

```text
Browser (index.html + styles.css + app.js)
  ├─ Parse YouTube / Instagram HTML returned by the Worker
  ├─ Render copy controls, metadata and media options
  └─ Keep recent links in localStorage only

Cloudflare Worker (worker/index.js)
  ├─ Validate HTTPS and an explicit platform/CDN hostname allow-list
  ├─ Fetch public source HTML or directly exposed media
  ├─ Add permissive CORS headers for this frontend
  └─ Stream media with Content-Disposition when ?download=1 is requested

Cloudflare Pages
  └─ Serves the static website; no build command is needed
```

The Worker is a fetch proxy for public HTML/media. It is **not a platform API** and has no API key. The host allow-list is a security control; do not turn it into an unrestricted URL proxy.

## Quick start

1. Extract the ZIP to a folder.
2. Open `config.js` and check `workerBaseUrl`. It is prefilled with the existing Worker URL from this project's setup: `https://instatube-proxy.xboyrex496.workers.dev`.
3. Test the static UI locally with any simple static server. For example, with Python installed:

   ```bash
   python -m http.server 8080
   ```

   Open `http://localhost:8080`.

4. Deploy the included Worker source (recommended) if you want the allow-list, redirect validation and direct-media download behavior shipped in this ZIP:

   ```bash
   cd worker
   npx wrangler login
   npx wrangler deploy
   ```

   `worker/wrangler.toml` names the Worker `instatube-proxy`, matching the URL prefilled in `config.js`. This replaces the existing Worker script for that name in the Cloudflare account selected by `wrangler login`. Review the file and make sure you intend to update that Worker before deploying. If you use a different Worker name or URL, update `config.js` to match.

5. Deploy the static site to Cloudflare Pages. Create a Pages project named `rexmedia-studio` first if it doesn't exist, then from the project root run:

   ```bash
   npx wrangler pages deploy . --project-name=rexmedia-studio --branch=main
   ```

   You can also connect the GitHub repository to Cloudflare Pages. Use no build command and set the output directory to `/` (the repository root). See `DEPLOYMENT.md` for the exact checklist.

## Project files

- `index.html` — page structure, accessible labels and SVG icon sprite.
- `styles.css` — responsive design, desktop/mobile layouts and theme variables.
- `app.js` — URL validation, metadata parsers, result renderer, clipboard, recent history and interactions.
- `config.js` — public Worker URL only (no secrets).
- `worker/index.js` — allow-listed Cloudflare Worker source.
- `worker/wrangler.toml` — Worker deployment configuration.
- `manifest.webmanifest` and `assets/icon-*.png` — PWA metadata and Android-ready app icons for the later APK phase.
- `APK-NEXT-STEPS.md` — guidance for packaging the deployed site later.
- `scripts/smoke-test.mjs` — Worker security and response smoke tests.
- `_headers` — static response security headers and conservative cache rules.
- `DEPLOYMENT.md` — GitHub and Cloudflare deployment instructions.

## Check the code

Requires Node.js for syntax checks; the website itself has no npm runtime dependencies.

```bash
npm install
npm run check
```

The `wrangler` package is only needed for deployment/development workflows.

## Security notes

- Never put Cloudflare API tokens or other secrets in `config.js`, `app.js` or GitHub source files.
- The included Worker rejects non-HTTPS sources, credentialed URLs, custom ports and hosts outside the allow-list, and revalidates redirect targets.
- The Worker does not accept cookies from the visitor and does not forward upstream `Set-Cookie` headers.
- If a new official platform flow is needed later, use the platform's supported developer integration and review its terms first.

## Branding

**RexMedia Studio** · **by XboyRex**

This project is not affiliated with YouTube, Instagram, Google or Meta.


## v1.1.0 notes

- Replaced the decorative, multi-panel landing page with a compact, responsive interface.
- YouTube metadata now falls back to Open Graph/title/description metadata when the player JSON is unavailable. Empty or blocked pages produce an explicit error rather than a successful-looking `Untitled video` result.
- Instagram extraction now attempts the original public post and the public `/embed/captioned/` page, and inspects exposed Open Graph, HTML media and structured-data sources. This is best-effort; Instagram may require sign-in or not expose a direct media URL.
- Copy buttons are disabled when no source text was exposed.
- The tool downloads YouTube thumbnails and directly exposed Instagram media. It does not extract YouTube video/audio streams. Download your own uploads with YouTube Studio; other videos should be saved only using platform-authorized options.

### Validation status

`npm run check` and `npm test` validate JavaScript syntax and Worker request handling. They do not establish that Instagram or YouTube will expose metadata for every link. Test real public links after deployment.
