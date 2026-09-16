# ============================================================
# Telegram File Monitor - Production Dockerfile
# Build context: app/ directory
#   cd app && docker build -t tgfiledownload .
# ============================================================

# ---- Stage 1: Build frontend ----
FROM oven/bun:1.4 AS frontend-builder

WORKDIR /build
COPY frontend/package.json frontend/package-lock.json* ./
RUN bun install --frozen-lockfile

COPY frontend/ ./
RUN bun run build

# ---- Stage 2: Production image ----
FROM oven/bun:1.4

WORKDIR /app

# Copy server code & install dependencies (includes node-telegram-bot-api from npm)
COPY server/package.json server/bun.lock* ./server/
RUN cd server && bun install --frozen-lockfile
COPY server/ ./server/

# Copy built frontend from stage 1
COPY --from=frontend-builder /build/dist ./frontend/dist

# Data directories
RUN mkdir -p /app/data/db /app/data/downloads

ENV DATA_DIR=/app/data/db
ENV DB_PATH=/app/data/db/app.db
ENV FRONTEND_DIST=/app/frontend/dist
ENV PORT=3000

EXPOSE 3000

CMD ["bun", "run", "server/src/index.ts"]