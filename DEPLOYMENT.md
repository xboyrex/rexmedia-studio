# Deploy RexMedia Studio

## A. Check before publishing

1. Open `config.js` and confirm `workerBaseUrl` matches the Cloudflare Worker you want to use.
2. The prefilled Worker URL is `https://instatube-proxy.xboyrex496.workers.dev`.
3. `worker/wrangler.toml` is set to `instatube-proxy`. Deploying it will replace the code on that Worker in the selected Cloudflare account. If you want to preserve an existing Worker, change `name` to a new Worker name and update `config.js` to its resulting URL before publishing.
4. Run `npm install` and `npm run check` if Node.js is available.

## B. Deploy / update the Worker

In Termux or a desktop terminal, from the extracted project folder:

```bash
cd worker
npx wrangler login
npx wrangler deploy
```

Authorize Wrangler in the browser, then return to the terminal. When deployment finishes, check the JSON health endpoint:

`https://instatube-proxy.xboyrex496.workers.dev/health`

It should return `ok: true`. If the account you're logged into doesn't own the prefilled Worker name, use a new name in `wrangler.toml`, deploy it, and replace `workerBaseUrl` in the root `config.js` with the deployed Workers URL.

## C. Push to GitHub

1. Create a new empty repository in your own GitHub account. Recommended repository name: `rexmedia-studio`.
2. Extract this ZIP. Upload the **contents** of the `rexmedia-studio` folder to the repository root, not the enclosing folder.
3. Commit the files to the `main` branch.
4. Keep tokens and passwords out of the repository. The prefilled `config.js` contains only a public Worker endpoint, not a credential.

## D. Deploy on Cloudflare Pages

### Git-connected workflow

1. Open Cloudflare Dashboard → **Workers & Pages** → **Create** → **Pages** → connect to Git.
2. Select your GitHub repository.
3. Project name: `rexmedia-studio`.
4. Production branch: `main`.
5. Framework preset: `None` / no framework.
6. Build command: leave blank.
7. Build output directory: `/` (repository root).
8. Save and deploy.

A later Git push to `main` should trigger a new Pages deployment. Verify that `index.html`, `styles.css`, `app.js`, `config.js` and `assets/favicon.svg` are present in the published root.

### Direct Wrangler workflow

Create the Pages project in the dashboard first if required, then run from the project root:

```bash
npx wrangler pages deploy . --project-name=rexmedia-studio --branch=main
```

## E. Smoke test after deployment

1. Open the public Pages domain in a private/incognito tab.
2. Check that the main UI renders, switch between YouTube and Instagram, toggle theme, and clear local history.
3. Open `https://instatube-proxy.xboyrex496.workers.dev/health` (or your chosen Worker URL) and confirm `ok: true`.
4. Try a public, non-age-restricted YouTube video, then a public Instagram post/Reel you have permission to access.
5. Confirm downloads return media and not an HTML login/challenge page.
6. If a field is missing, that is not always a code error; the platform may not expose it in public page HTML. The UI should say so instead of manufacturing a result.

## Notes

- No developer API key is configured or required by the included best-effort scraper.
- The Worker is required for cross-origin fetching and download headers. It is intentionally not an unrestricted proxy.
- YouTube and Instagram can block public-page requests or change markup. End-to-end functionality cannot honestly be guaranteed for every post, video, track or highlight.
- The tool doesn't support visiting creator profiles, accessing private content or logging in to Instagram.


## v1.1.0 clean update from Android / Termux

Use the included `termux-push.sh` after saving `RexMedia-Studio-v1.1.0-clean.zip` in the Android Download folder. It backs up local repository files, replaces the tracked project files with this ZIP, runs checks/tests, commits and pushes to `main` without force-pushing. GitHub-connected Cloudflare Pages should start a deployment after the push. It also attempts a separate Wrangler Worker deploy; if Wrangler cannot run or authenticate on Android, the script prints a warning without undoing the push.

The script does not claim extraction works against every platform response. After deployment, test at least one known public YouTube link and one public Instagram Reel. If Instagram returns a login/challenge response or exposes no media URL, the tool reports that limitation instead of bypassing it.
