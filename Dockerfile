FROM node:22-alpine AS builder

RUN npm install -g pnpm@9.15.4

WORKDIR /app

# Copy workspace config (cached layer -- only changes when deps change)
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml tsconfig.base.json ./

# Copy all package.json files
COPY packages/shared/package.json packages/shared/
COPY packages/engine/package.json packages/engine/
COPY packages/api/package.json packages/api/
COPY packages/web/package.json packages/web/

# Install dependencies
RUN pnpm install --frozen-lockfile

# Copy source
COPY packages/shared/ packages/shared/
COPY packages/engine/ packages/engine/
COPY packages/api/ packages/api/
COPY packages/web/ packages/web/

# Build all packages in dependency order
ENV NODE_OPTIONS="--max-old-space-size=2048"
RUN pnpm -r build

# --- Production image ---
FROM node:22-alpine

RUN npm install -g pnpm@9.15.4 && \
    addgroup -S appgroup && adduser -S appuser -G appgroup

WORKDIR /app

COPY package.json pnpm-workspace.yaml pnpm-lock.yaml tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/
COPY packages/engine/package.json packages/engine/
COPY packages/api/package.json packages/api/

RUN pnpm install --frozen-lockfile --prod

# Copy built artifacts
COPY --from=builder /app/packages/shared/dist packages/shared/dist
COPY --from=builder /app/packages/engine/dist packages/engine/dist
COPY --from=builder /app/packages/api/dist packages/api/dist
COPY --from=builder /app/packages/web/build packages/web/build

RUN chown -R appuser:appgroup /app

EXPOSE 3000

ENV NODE_ENV=production

USER appuser

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://localhost:3000/api/health || exit 1

CMD ["node", "packages/api/dist/index.js"]
