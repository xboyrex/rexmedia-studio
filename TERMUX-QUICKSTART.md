# RexMedia Studio v1.1.0 — Termux quick start

1. Download `RexMedia-Studio-v1.1.0-clean.zip` to Android's `Download` folder.
2. Download the standalone `RexMedia-Studio-v1.1.0-Termux-Push.sh` script to the same folder, or extract this ZIP and use the included `termux-push.sh`.
3. Open Termux and run:

```bash
termux-setup-storage
bash /sdcard/Download/RexMedia-Studio-v1.1.0-Termux-Push.sh
```

If the script is inside the ZIP instead of downloaded separately, extract it first and run its actual path, for example:

```bash
mkdir -p ~/rexmedia-package
unzip -o /sdcard/Download/RexMedia-Studio-v1.1.0-clean.zip -d ~/rexmedia-package
bash ~/rexmedia-package/rexmedia-studio/termux-push.sh
```

The script asks you to authenticate with GitHub in a browser if needed, backs up the local project files, updates the local clone from `origin/main`, replaces it with the release, runs checks/tests, commits and pushes. It does not force-push. When the repo is connected to Cloudflare Pages, GitHub's push should trigger a new Pages deployment. The script also attempts to deploy the Cloudflare Worker via Wrangler; if Android/Termux authentication fails, it prints a warning and leaves the successful GitHub push intact.

## Important limits

- The script can't bypass GitHub permissions; your account must have write access to `xboyrex/rexmedia-studio`.
- This release improves parsing and failure feedback but does not guarantee metadata or direct media URLs for every URL.
- YouTube thumbnail downloads and metadata copy are supported. It does not extract video/audio streams from YouTube. For videos you uploaded, use YouTube Studio.
- Instagram downloads work only if a public request/embedded page exposes a direct CDN media URL. Login-gated or private content is not bypassed.
