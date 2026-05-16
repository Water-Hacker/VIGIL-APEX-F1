# syntax=docker/dockerfile:1.7
# VIGIL APEX adapter-runner — runs all 26 scrapers on Hetzner N02.
# Includes Playwright Chromium + Tor.

FROM mcr.microsoft.com/playwright:v1.60.0-jammy@sha256:e1529a04087193966ea15d4a1617345bdaa0791690a24ab2c42b65f9ce5b2cdc AS base
ENV DEBIAN_FRONTEND=noninteractive
RUN apt-get update && apt-get install -y --no-install-recommends \
      tor torsocks dumb-init tzdata && \
    rm -rf /var/lib/apt/lists/* && \
    ln -fs /usr/share/zoneinfo/Africa/Douala /etc/localtime && \
    echo "Africa/Douala" > /etc/timezone && \
    groupadd -g 1000 vigil && useradd -u 1000 -g vigil -m vigil

WORKDIR /repo
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json tsconfig.base.json ./
COPY apps ./apps
COPY packages ./packages
RUN corepack enable && corepack prepare pnpm@9.7.0 --activate
RUN pnpm install --frozen-lockfile
RUN pnpm run build --filter "@vigil/*..." --filter "...^./apps/adapter-runner"

FROM mcr.microsoft.com/playwright:v1.60.0-jammy@sha256:e1529a04087193966ea15d4a1617345bdaa0791690a24ab2c42b65f9ce5b2cdc AS runtime
ENV NODE_ENV=production TZ=Africa/Douala
RUN apt-get update && apt-get install -y --no-install-recommends \
      tor torsocks dumb-init tzdata curl && \
    rm -rf /var/lib/apt/lists/* && \
    ln -fs /usr/share/zoneinfo/Africa/Douala /etc/localtime && \
    groupadd -g 1000 vigil && useradd -u 1000 -g vigil -m vigil

WORKDIR /app
COPY --from=base --chown=vigil:vigil /repo/package.json /repo/pnpm-workspace.yaml /repo/turbo.json /repo/tsconfig.base.json ./
COPY --from=base --chown=vigil:vigil /repo/node_modules ./node_modules
COPY --from=base --chown=vigil:vigil /repo/packages ./packages
COPY --from=base --chown=vigil:vigil /repo/apps/adapter-runner ./apps/adapter-runner
COPY --chown=vigil:vigil infra/docker/adapter-runner/torrc /etc/tor/torrc

USER vigil
EXPOSE 9100
ENTRYPOINT ["dumb-init", "--"]
CMD ["sh", "-c", "tor -f /etc/tor/torrc & sleep 5 && node apps/adapter-runner/dist/index.js"]
