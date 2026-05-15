# syntax=docker/dockerfile:1.7
# VIGIL APEX dashboard — Next.js 14 standalone build.

FROM node:20.20.2-alpine AS deps
RUN apk add --no-cache libc6-compat
WORKDIR /repo
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json tsconfig.base.json ./
COPY apps ./apps
COPY packages ./packages
RUN corepack enable && corepack prepare pnpm@9.7.0 --activate
RUN pnpm install --frozen-lockfile

FROM deps AS builder
ENV NEXT_TELEMETRY_DISABLED=1
RUN pnpm run build --filter "@vigil/*..." --filter "...^./apps/dashboard"

FROM node:20.20.2-alpine AS runtime
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV TZ=Africa/Douala
RUN apk add --no-cache dumb-init tzdata && \
    cp /usr/share/zoneinfo/Africa/Douala /etc/localtime && \
    addgroup -S vigil -g 1000 && \
    adduser -S vigil -u 1000 -G vigil
WORKDIR /app
COPY --from=builder --chown=vigil:vigil /repo/apps/dashboard/.next/standalone ./
COPY --from=builder --chown=vigil:vigil /repo/apps/dashboard/.next/static ./.next/static
COPY --from=builder --chown=vigil:vigil /repo/apps/dashboard/public ./public
USER vigil
EXPOSE 3000 9100
ENV PORT=3000 HOSTNAME=0.0.0.0
ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "server.js"]
