FROM node:22-alpine AS builder

RUN npm install -g pnpm@9.15.4

WORKDIR /app

# Copy workspace config
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

# Build shared types
RUN pnpm --filter @reclaim/shared build

# Build engine
RUN pnpm --filter @reclaim/engine build

# Build API
RUN pnpm --filter @reclaim/api build

# Build frontend
RUN pnpm --filter web build

# --- Production image ---
FROM node:22-alpine

RUN npm install -g pnpm@9.15.4

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

EXPOSE 3000

VOLUME /app/data

ENV DB_PATH=/app/data/reclaim.db
ENV NODE_ENV=production

RUN addgroup -S appgroup && adduser -S appuser -G appgroup
RUN chown -R appuser:appgroup /app
USER appuser

CMD ["node", "packages/api/dist/index.js"]
