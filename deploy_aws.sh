#!/bin/bash
KEY="/Users/huiyong/Desktop/Hedge Fund/LightsailDefaultKey-ap-northeast-2.pem"
HOST="bitnami@43.203.120.8"

echo "Connecting to AWS..."
ssh -o StrictHostKeyChecking=no -i "$KEY" $HOST << 'EOF'
set -x
source ~/.bashrc
cd /home/bitnami/ai-hedge-fund
git fetch origin
git pull origin main

# Restart Backend via systemd (hedge-backend.service owns :8000).
# A manual nohup uvicorn would squat the port and leave the systemd unit in a
# perpetual bind-fail restart loop, so always go through systemctl.
sudo systemctl restart hedge-backend.service
sleep 3
systemctl is-active hedge-backend.service && echo "Backend restarted."

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
