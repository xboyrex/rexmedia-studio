#!/data/data/com.termux/files/usr/bin/bash
set -Eeuo pipefail

REPO="https://github.com/xboyrex/rexmedia-studio.git"
PROJECT="${REX_PROJECT_DIR:-$HOME/rexmedia-studio}"
ZIP="${1:-/sdcard/Download/RexMedia-Studio-v1.1.0-clean.zip}"
BRANCH="main"
TMP="$HOME/.rexmedia-v1.1.0-unpack"

fail() { echo; echo "[ERROR] $*" >&2; exit 1; }
trap 'echo; echo "[ERROR] Line $LINENO failed. No force-push was attempted." >&2' ERR

echo "RexMedia Studio v1.1.0 — Termux clean update + push"
echo "ZIP: $ZIP"

pkg update -y
pkg install -y git gh unzip rsync nodejs
termux-setup-storage || true
[ -f "$ZIP" ] || fail "ZIP not found. Save RexMedia-Studio-v1.1.0-clean.zip in Download, or pass its path as the first argument."

if [ ! -d "$PROJECT/.git" ]; then
  git clone "$REPO" "$PROJECT"
fi
cd "$PROJECT"
git remote set-url origin "$REPO"
if ! gh auth status --hostname github.com >/dev/null 2>&1; then
  gh auth login --hostname github.com --git-protocol https --web
fi
gh auth setup-git

STAMP="$(date +%Y%m%d-%H%M%S)"
BACKUP="$HOME/rexmedia-backup-$STAMP"
mkdir -p "$BACKUP"
rsync -a --exclude='.git/' "$PROJECT/" "$BACKUP/"
echo "File backup: $BACKUP"

# Preserve the existing local commit as a backup ref, then sync to remote main.
git branch "backup/local-before-v1.1.0-$STAMP" HEAD >/dev/null 2>&1 || true
git fetch origin
git switch --discard-changes "$BRANCH"
git reset --hard "origin/$BRANCH"
git clean -fd

rm -rf "$TMP"
mkdir -p "$TMP"
unzip -q "$ZIP" -d "$TMP"
if [ -f "$TMP/rexmedia-studio/index.html" ]; then
  SRC="$TMP/rexmedia-studio"
elif [ -f "$TMP/index.html" ]; then
  SRC="$TMP"
else
  fail "ZIP did not contain project index.html."
fi

# Cleanly replace project files. .git history and backup branch are retained.
rsync -a --delete --exclude='.git/' "$SRC/" "$PROJECT/"
cd "$PROJECT"
node --check app.js
node --check worker/index.js
npm run check
npm test

if [ -z "$(git config user.name || true)" ]; then git config user.name "XboyRex"; fi
if [ -z "$(git config user.email || true)" ]; then
  read -r -p "Git author email: " EMAIL
  [ -n "$EMAIL" ] || fail "Git author email is required for the commit."
  git config user.email "$EMAIL"
fi

git add -A
if git diff --cached --quiet; then
  echo "No changes to commit; repository already matches this release."
else
  git commit -m "release: RexMedia Studio v1.1.0 clean redesign and extraction fallbacks"
  git push origin "$BRANCH"
fi

echo
echo "GitHub push completed. Checking optional direct Worker deployment..."
# Pages is connected to GitHub and should deploy from the push. The Worker is
# deployed separately, so attempt Wrangler after the source push; don't undo it
# if Wrangler/Android authentication is unavailable.
if npm install --no-package-lock; then
  if ! npx wrangler whoami >/dev/null 2>&1; then
    echo "Cloudflare login is needed for the Worker deployment."
    npx wrangler login || true
  fi
  if npx wrangler whoami >/dev/null 2>&1; then
    if npm run worker:deploy; then
      echo "Cloudflare Worker deployment succeeded."
    else
      echo "[WARNING] GitHub push succeeded, but Worker deployment failed. Deploy worker/index.js from Cloudflare dashboard or rerun this script on desktop Linux."
    fi
  else
    echo "[WARNING] GitHub push succeeded, but Wrangler could not authenticate in Termux. Deploy worker/index.js from the Cloudflare dashboard, or run npm run worker:deploy on a desktop terminal after Wrangler login."
  fi
else
  echo "[WARNING] GitHub push succeeded, but Wrangler dependencies failed to install in Termux. The Pages GitHub deployment should still start. Deploy worker/index.js separately if needed."
fi

echo
echo "Repo: https://github.com/xboyrex/rexmedia-studio"
echo "Pages: https://rexmedia-studio.pages.dev"
echo "Check the latest deployment in Cloudflare Pages."
echo "Real platform extraction remains best-effort and must be tested after deployment."
