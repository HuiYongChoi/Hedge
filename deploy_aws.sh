#!/bin/bash
set -euo pipefail

# Target: current Debian LAMP instance (apache2 + systemd), web root /var/www/html.
# Override HEDGE_HOST/HEDGE_USER/HEDGE_KEY/HEDGE_WEBROOT only for a future server move.
KEY="${HEDGE_KEY:-/Users/huiyong/Desktop/Hedge Fund/lamp-1_260530.pem}"
HOST_IP="${HEDGE_HOST:-43.203.120.8}"
SSH_USER="${HEDGE_USER:-admin}"
WEBROOT="${HEDGE_WEBROOT:-/var/www/html/hedge}"
HOST="${SSH_USER}@${HOST_IP}"

echo "Deploying to ${HOST} (web root ${WEBROOT}) ..."
ssh -o StrictHostKeyChecking=no -i "$KEY" "$HOST" "WEBROOT='${WEBROOT}' bash -s" <<'EOF'
set -x
source ~/.bashrc 2>/dev/null || true
WEBROOT="${WEBROOT:-/var/www/html/hedge}"

# $HOME keeps this correct for the current SSH user.
APP_DIR="$HOME/ai-hedge-fund"
cd "$APP_DIR"
if [ -n "$(git status --porcelain)" ]; then
  git stash push -u -m "pre-deploy-$(date +%Y%m%d%H%M%S)"
  RESTORE_STASH=1
else
  RESTORE_STASH=0
fi
git fetch origin
git pull --ff-only origin main
if [ "$RESTORE_STASH" = "1" ]; then
  git stash pop || echo "Skipped automatic stash restore; resolve manually on the server if needed."
fi

# Restart backend (hedge-backend.service owns 127.0.0.1:8000).
sudo systemctl restart hedge-backend.service
sleep 3
systemctl is-active hedge-backend.service && echo "Backend restarted."

# Build frontend.
export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"

cd "$APP_DIR/app/frontend"
# Build into a fresh dist so a failed (e.g. OOM) build cannot leave a stale dist behind.
rm -rf dist
npm install
NODE_OPTIONS=--max-old-space-size=4096 npm run build -- --base=/hedge/
# Only swap the live web root after a verified build. If the build failed (OOM, etc.),
# dist/index.html is missing and we abort here, leaving the live site untouched.
if [ ! -f dist/index.html ]; then
  echo "BUILD FAILED: dist/index.html missing — aborting deploy, live site untouched." >&2
  exit 1
fi
sudo rm -rf "$WEBROOT"
sudo mkdir -p "$WEBROOT"
sudo cp -r dist/. "$WEBROOT"/
echo "Frontend built and copied to $WEBROOT."
EOF
