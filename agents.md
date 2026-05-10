# AI Hedge Fund Agents Architecture

@claude.md

## Fast Handoff Notes

Use this repo from `/Users/huiyong/Desktop/Hedge Fund/ai-hedge-fund`.

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
docs/forward_per/v3_agent_integration/
docs/ui/
tmp/
```

Prefer explicit path staging:

```bash
git add path/to/file.py path/to/test.py
git diff --cached --check
git commit -m "feat(scope): short summary"
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

### Fast Server Deploy When GitHub Push Is Blocked

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

4. Run the existing deploy script:

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

Latest deployed commit via this path:

```text
4157215 feat(forward-per): inject forward outlook into agents
```
