#!/bin/bash
# Zero-downtime rolling update for api-backend-1 and api-backend-2
# Run from nginx-proxy VM
# Usage: BRANCH=main ./rolling-update.sh

set -e
BRANCH="${BRANCH:-main}"
NGINX_CONF="/etc/nginx/sites-available/trafico.conf"

drain_backend() {
  sed -i "s/server $1:3000$/server $1:3000 down/" "$NGINX_CONF"
  nginx -s reload
  echo "[1] $1 drained from pool"
  sleep 5
}

deploy_backend() {
  ssh ubuntu@$1 "cd /app && git fetch origin && git checkout $BRANCH && git pull && npm install --production && pm2 restart api-backend"
  echo "[2] $1 updated to branch=$BRANCH"
}

restore_backend() {
  sed -i "s/server $1:3000 down/server $1:3000/" "$NGINX_CONF"
  nginx -s reload
  echo "[3] $1 restored to pool"
  sleep 5
}

echo "=== Rolling update to branch=$BRANCH ==="

drain_backend   "api-backend-2.trafico.internal"
deploy_backend  "api-backend-2.trafico.internal"
restore_backend "api-backend-2.trafico.internal"

drain_backend   "api-backend-1.trafico.internal"
deploy_backend  "api-backend-1.trafico.internal"
restore_backend "api-backend-1.trafico.internal"

echo "=== Rolling update complete ==="
