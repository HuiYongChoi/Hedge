#!/bin/bash
KEY="/Users/huiyong/Desktop/Hedge Fund/LightsailDefaultKey-ap-northeast-2.pem"
HOST="bitnami@54.116.99.19"

echo "Connecting to AWS..."
ssh -o StrictHostKeyChecking=no -i "$KEY" $HOST << 'EOF'
set -x
source ~/.bashrc
cd /home/bitnami/ai-hedge-fund
git fetch origin
git pull origin main

# Restart Backend
sudo fuser -k 8000/tcp || true
sleep 2
nohup /home/bitnami/.local/bin/poetry run uvicorn app.backend.main:app --host 127.0.0.1 --port 8000 > backend.log 2>&1 &
echo "Backend restarted."

# Build Frontend
export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"

cd /home/bitnami/ai-hedge-fund/app/frontend
npm install
NODE_OPTIONS=--max-old-space-size=4096 npm run build -- --base=/hedge/
sudo rm -rf /opt/bitnami/apache/htdocs/hedge/*
sudo mkdir -p /opt/bitnami/apache/htdocs/hedge
sudo cp -r dist/* /opt/bitnami/apache/htdocs/hedge/
echo "Frontend built and copied."
EOF
