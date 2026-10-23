# Build context: repository root (see docker-compose.yml).
FROM node:22-alpine AS build
WORKDIR /repo
COPY package.json package-lock.json ./
COPY packages/circuit-core/package.json packages/circuit-core/
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
RUN npm ci
COPY tsconfig.base.json ./
COPY packages packages
COPY data data
COPY parts parts
COPY apps/api apps/api
RUN npm run build -w @breadpilot/api

FROM node:22-alpine AS prod-deps
WORKDIR /repo
COPY package.json package-lock.json ./
COPY packages/circuit-core/package.json packages/circuit-core/
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
RUN npm ci --omit=dev --workspace=@breadpilot/api

FROM node:22-alpine
ENV NODE_ENV=production \
    API_HOST=0.0.0.0 \
    API_PORT=3000 \
    MIGRATIONS_DIR=/repo/db/migrations
WORKDIR /repo
COPY --from=prod-deps /repo/node_modules node_modules
COPY --from=build /repo/apps/api/dist apps/api/dist
COPY db/migrations db/migrations
# Datasheets + verified data for RAG indexing. Copied (not bind-mounted) so it works even when
# Docker Desktop has no permission for the project folder (e.g. macOS-protected ~/Desktop).
COPY docs docs
COPY data data
WORKDIR /repo/apps/api
USER node
EXPOSE 3000
CMD ["node", "--enable-source-maps", "dist/server.js"]
