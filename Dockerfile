FROM node:22-alpine AS builder
RUN apk add --no-cache openssl
WORKDIR /app
COPY package*.json ./
RUN npm ci
RUN npm install --prefix /tmp/prisma-cli --no-save --no-audit --no-fund prisma@6.19.3
COPY . .
RUN npx prisma generate
RUN npm run build

FROM node:22-alpine AS runner
RUN apk add --no-cache openssl postgresql-client
WORKDIR /app
ENV NODE_ENV=production
RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 nextjs
RUN mkdir -p /app/uploads && chown nextjs:nodejs /app/uploads
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=builder /app/node_modules/prisma ./node_modules/prisma
COPY --from=builder /app/node_modules/@prisma ./node_modules/@prisma
COPY --from=builder /tmp/prisma-cli ./prisma-cli
COPY --from=builder /app/scripts/pre-deploy-backup.mjs ./scripts/pre-deploy-backup.mjs
USER nextjs
ENV PORT=8080
EXPOSE ${PORT}
CMD ["node", "server.js"]
