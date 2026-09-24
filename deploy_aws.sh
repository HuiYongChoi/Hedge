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

    # 본문에 영어·원시 필드명·중복 숫자가 남는지 — 거듭 지적받은 결함이라
    # 목록이 아니라 규칙으로 막고, 그 규칙이 살아 있는지 배포 때마다 확인한다.
    echo "본문 한국어 점검 중 ..."
    if ! (cd "$REPO_DIR/app/frontend" && "$NODE_BIN" scripts/check-korean-prose.mjs); then
      echo "✗ 본문 한국어 미달 — 배포를 중단합니다."
      exit 1
    fi

    # 섹션 분류가 '작성자가 붙인 구획'을 실제로 읽는지 — 이게 깨지면 리포트의
    # 04(리스크)가 통째로 비고, 문장 채점표는 그걸 만점으로 통과시킨다.
    echo "섹션 분류 점검 중 ..."
    if ! (cd "$REPO_DIR/app/frontend" && "$NODE_BIN" scripts/check-section-split.mjs); then
      echo "✗ 섹션 분류 미달 — 배포를 중단합니다."
      exit 1
    fi

    # 위 채점은 '문장이 잘 쓰였는가'만 본다. 분석이 통째로 버려져 보고서가 비면
    # 볼 문장이 없어 오히려 만점이 나온다(2026-08-30 실측). 건전성 채점표는
    # '보고서가 실제로 나왔는가'를 본다 — 그날의 실패 실행이 여전히 미달로
    # 잡히는지 확인해, 채점표가 무뎌진 채로 배포되는 것을 막는다.
    echo "보고서 건전성 채점표 점검 중 ..."
    if (cd "$REPO_DIR/app/frontend" && "$NODE_BIN" scripts/report-health-scorecard.mjs \
          ../../tests/fixtures/report_health/broken_run_000660_260830.json > /dev/null 2>&1); then
      echo "✗ 건전성 채점표가 실패한 보고서에 만점을 줬습니다 — 채점 규칙이 무뎌졌습니다."
      exit 1
    fi

    # 새로 만든 실행 결과가 tmp/report_health_rounds 에 있으면 그것도 채점한다.
    if ls "$REPO_DIR/tmp/report_health_rounds"/*.json >/dev/null 2>&1; then
      echo "최근 실행 결과 건전성 채점 중 ..."
      if ! (cd "$REPO_DIR/app/frontend" && "$NODE_BIN" scripts/report-health-scorecard.mjs \
              "$REPO_DIR"/tmp/report_health_rounds/*.json); then
        echo "✗ 보고서 건전성 미달 — 배포를 중단합니다."
        exit 1
      fi
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
