#!/bin/bash
set -euo pipefail

DEPLOY_PATH="${DEPLOY_PATH:-/root/job-tracker}"
SERVICE_NAME="${SERVICE_NAME:-job-tracker}"

cd "$DEPLOY_PATH"

if [ -z "${DATABASE_URL:-}" ]; then
	if [ -f .env.production ]; then
		set -a
		. ./.env.production
		set +a
	elif [ -f .env ]; then
		set -a
		. ./.env
		set +a
	fi
fi

npm ci
npx prisma generate
npx prisma migrate deploy
npm run build
cp -r .next/static .next/standalone/.next/static
cp -r public .next/standalone/public 2>/dev/null || true
systemctl restart "$SERVICE_NAME"
echo "Deployed"
