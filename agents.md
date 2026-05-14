# AI Hedge Fund Agents Architecture

@claude.md

## Fast Handoff Notes

Use this repo from `/Users/huiyong/Desktop/Hedge Fund/ai-hedge-fund`.

### Fast Path: Commit -> Push -> Deploy

When the user asks to finish quickly, keep the path narrow:

1. Verify only what proves the current change.
2. Stage explicit paths only.
3. Commit locally.
4. Push `main` if GitHub auth is available.
5. Deploy from the local machine with `./deploy_aws.sh`.
6. Smoke-check `/hedge/` and the backend process.

Do not assume a GitHub push deploys the server. The server deploy script still has to run, or the AWS checkout will remain on its previous commit.

### Verification

The local system `python`/`pytest` may not exist. Use the bundled runtime:

```bash
/Users/huiyong/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/bin/python3 -m pytest tests/ --ignore=tests/backtesting -q
```

Latest known good result from the forward outlook v3 work:

```text
177 passed, 3 warnings
```

### Commit Hygiene

The worktree can contain user-owned dirty docs or temp files. Do not stage them unless explicitly requested.

Common files to leave alone when unrelated:

```text
docs/forward_per/README.md
docs/agents/
docs/forward_per/v3_agent_integration/
docs/ui/
src/tools/company_name.py
tmp/
```

Prefer explicit path staging:

```bash
git add path/to/file.py path/to/test.py
git diff --cached --check
git commit -m "feat(scope): short summary"
```

Before committing, run the smallest relevant verification plus `git diff --check`. For frontend builds, local `npm` may be unavailable; use the bundled Node directly:

```bash
cd app/frontend
/Users/huiyong/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node ./node_modules/typescript/bin/tsc
/Users/huiyong/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node ./node_modules/vite/bin/vite.js build
```

### GitHub Push

`origin` uses HTTPS. If `git push origin main` fails with:

```text
fatal: could not read Username for 'https://github.com': Device not configured
```

do not spend time debugging unless the user wants auth setup. The user said GitHub auth can be handled later.

Recommended future auth path:

```bash
brew install gh
gh auth login
gh auth setup-git
git push origin main
```

If the user provides a GitHub PAT for a one-off push, do not put it in `git remote`, shell history, a file in the repo, or a command URL. Use a temporary `GIT_ASKPASS` helper and delete it immediately:

```bash
read -rsp "GitHub PAT: " GITHUB_TOKEN; echo
export GITHUB_TOKEN
tmpdir="$(mktemp -d)"
trap 'rm -rf "$tmpdir"; unset GITHUB_TOKEN' EXIT
cat > "$tmpdir/askpass.sh" <<'SH'
#!/bin/sh
case "$1" in
  *Username*) printf '%s\n' 'x-access-token' ;;
  *) printf '%s\n' "$GITHUB_TOKEN" ;;
esac
SH
chmod 700 "$tmpdir/askpass.sh"
GIT_ASKPASS="$tmpdir/askpass.sh" GIT_TERMINAL_PROMPT=0 git push origin main
git fetch origin
git rev-list --left-right --count origin/main...HEAD
```

Expected verification after a successful push:

```text
0	0
```

Always tell the user to revoke/rotate a PAT that was pasted into a chat.

Recent successful GitHub push example through this flow:

```text
ce56c89 feat(report): polish price compass and docs
```

### Fast Server Deploy

Preferred path after GitHub push: run the repo deploy script from the local machine, not from inside the server.

```bash
./deploy_aws.sh
```

The script SSHes to `bitnami@54.116.99.19`, pulls `origin/main`, restarts the backend, runs `npm install`, builds with `npm run build -- --base=/hedge/`, and copies `dist/` into `/opt/bitnami/apache/htdocs/hedge/`.

Do not run `./deploy_aws.sh` while already SSHed into `/home/bitnami/ai-hedge-fund`; it references the local key path and will fail from the server.

Expected successful deploy signals:

```text
Backend restarted.
✓ built in ...
Frontend built and copied.
```

Quick smoke checks:

```bash
curl -I --max-time 10 http://54.116.99.19/hedge/
ssh -o StrictHostKeyChecking=no -i "/Users/huiyong/Desktop/Hedge Fund/LightsailDefaultKey-ap-northeast-2.pem" bitnami@54.116.99.19 \
  'cd /home/bitnami/ai-hedge-fund && git rev-parse --short HEAD && pgrep -af "uvicorn app.backend.main:app" | head -3'
```

Recent successful server deploy example through this flow:

```text
ce56c89 feat(report): polish price compass and docs
```

### Bundle Deploy When GitHub Push Is Blocked

The AWS deploy script normally pulls `origin/main`, but when GitHub auth blocks pushing, deploy by sending a git bundle to the server and then running the deploy script.

1. Check server HEAD and confirm it is an ancestor of local `HEAD`:

```bash
ssh -o StrictHostKeyChecking=no -i "/Users/huiyong/Desktop/Hedge Fund/LightsailDefaultKey-ap-northeast-2.pem" bitnami@54.116.99.19 \
  'cd /home/bitnami/ai-hedge-fund && git rev-parse --short HEAD && git status --short'

git merge-base --is-ancestor <server-head> HEAD
```

2. Create and copy a bundle:

```bash
git bundle create /tmp/hedge-deploy.bundle main ^<server-head>
git bundle verify /tmp/hedge-deploy.bundle
scp -o StrictHostKeyChecking=no -i "/Users/huiyong/Desktop/Hedge Fund/LightsailDefaultKey-ap-northeast-2.pem" \
  /tmp/hedge-deploy.bundle bitnami@54.116.99.19:/tmp/hedge-deploy.bundle
```

3. On the server, preserve any dirty working tree, fast-forward, then verify HEAD:

```bash
ssh -o StrictHostKeyChecking=no -i "/Users/huiyong/Desktop/Hedge Fund/LightsailDefaultKey-ap-northeast-2.pem" bitnami@54.116.99.19 << 'EOF'
set -euo pipefail
cd /home/bitnami/ai-hedge-fund
if [ -n "$(git status --porcelain)" ]; then
  git stash push -u -m "pre-deploy-$(date +%Y%m%d%H%M%S)"
fi
git bundle verify /tmp/hedge-deploy.bundle
git fetch /tmp/hedge-deploy.bundle main
git merge --ff-only FETCH_HEAD
git rev-parse --short HEAD
git status --short
EOF
```

4. Return to the local machine and run the existing deploy script:

```bash
./deploy_aws.sh
```

Expected successful deploy signals:

```text
Backend restarted.
✓ built in ...
Frontend built and copied.
```

5. Quick smoke checks:

```bash
curl -I --max-time 10 http://54.116.99.19/hedge/
ssh -o StrictHostKeyChecking=no -i "/Users/huiyong/Desktop/Hedge Fund/LightsailDefaultKey-ap-northeast-2.pem" bitnami@54.116.99.19 \
  'cd /home/bitnami/ai-hedge-fund && git rev-parse --short HEAD && pgrep -af "uvicorn app.backend.main:app" | head -3'
```

Last confirmed fallback bundle deploy via this path:

```text
a35f5c1 fix(ui): scope topbar controls
```
