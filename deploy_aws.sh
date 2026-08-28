#!/bin/bash
set -euo pipefail

# Target: current Debian LAMP instance (apache2 + systemd), web root /var/www/html.
# Override HEDGE_HOST/HEDGE_USER/HEDGE_KEY/HEDGE_WEBROOT only for a future server move.
KEY="${HEDGE_KEY:-/Users/huiyong/Desktop/Hedge Fund/lamp-1_260530.pem}"
HOST_IP="${HEDGE_HOST:-43.203.120.8}"
SSH_USER="${HEDGE_USER:-admin}"
WEBROOT="${HEDGE_WEBROOT:-/var/www/html/hedge}"
HOST="${SSH_USER}@${HOST_IP}"

# ── 배포 전 보고서 품질 게이트 ───────────────────────────────────────────────
# 실제 저장된 리포트 본문을 전부 채점한다. 한 건이라도 미달이면 배포하지 않는다.
# 결함을 사용자가 화면에서 발견하고 지적하는 것보다, 여기서 막는 편이 낫다.
# 급할 때는 SKIP_REPORT_QUALITY_GATE=1 로 건너뛸 수 있다(그 사실이 로그에 남는다).
if [ "${SKIP_REPORT_QUALITY_GATE:-0}" = "1" ]; then
  echo "⚠ 보고서 품질 게이트를 건너뜁니다 (SKIP_REPORT_QUALITY_GATE=1)."
else
  NODE_BIN="${HEDGE_NODE:-/Users/huiyong/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node}"
  REPO_DIR="$(cd "$(dirname "$0")" && pwd)"
  if [ -x "$NODE_BIN" ] && [ -d "$REPO_DIR/app/frontend/node_modules/typescript" ]; then
    echo "보고서 품질 채점 중 ..."
    if ! (cd "$REPO_DIR/app/frontend" && "$NODE_BIN" scripts/report-quality-sweep.mjs \
            ../../tests/fixtures/corpus ../../tests/fixtures/report_defects.txt --rounds 2); then
      echo "✗ 보고서 품질 미달 — 배포를 중단합니다. 위 감점 항목을 먼저 고치세요."
      exit 1
    fi
  else
    echo "⚠ node 또는 typescript 가 없어 품질 게이트를 실행하지 못했습니다."
  fi
fi

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
