# syntax=docker/dockerfile:1.7
# VIGIL APEX worker image — generic for any worker-* app.
# Multi-stage; runtime is distroless / minimal Alpine.

# Stage 1 — deps
FROM node:20.17.0-alpine AS deps
RUN apk add --no-cache libc6-compat dumb-init
WORKDIR /repo
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json tsconfig.base.json ./
COPY apps ./apps
COPY packages ./packages
RUN corepack enable && corepack prepare pnpm@9.7.0 --activate
RUN pnpm install --frozen-lockfile

# Stage 2 — build
FROM deps AS builder
ARG WORKER_NAME
RUN test -n "$WORKER_NAME" || (echo "WORKER_NAME build-arg required" && exit 1)
RUN pnpm run build --filter "@vigil/*..." --filter "...^./apps/${WORKER_NAME}"

# Stage 3 — runtime (minimal)
FROM node:20.17.0-alpine AS runtime
ARG WORKER_NAME
ENV NODE_ENV=production
ENV TZ=Africa/Douala
RUN apk add --no-cache dumb-init tzdata && \
    cp /usr/share/zoneinfo/Africa/Douala /etc/localtime && \
    echo "Africa/Douala" > /etc/timezone && \
    addgroup -S vigil -g 1000 && \
    adduser -S vigil -u 1000 -G vigil
WORKDIR /app
# Copy only what's needed
COPY --from=builder --chown=vigil:vigil /repo/package.json /repo/pnpm-workspace.yaml /repo/turbo.json /repo/tsconfig.base.json ./
COPY --from=builder --chown=vigil:vigil /repo/node_modules ./node_modules
COPY --from=builder --chown=vigil:vigil /repo/packages ./packages
COPY --from=builder --chown=vigil:vigil /repo/apps/${WORKER_NAME} ./apps/${WORKER_NAME}

USER vigil
EXPOSE 9100
ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "apps/${WORKER_NAME}/dist/index.js"]
