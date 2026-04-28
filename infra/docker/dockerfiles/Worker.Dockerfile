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
RUN apk add --no-cache dumb-init tzdata gnupg && \
    cp /usr/share/zoneinfo/Africa/Douala /etc/localtime && \
    echo "Africa/Douala" > /etc/timezone && \
    addgroup -S vigil -g 1000 && \
    adduser -S vigil -u 1000 -G vigil

# ---- Phase F12 — deterministic .docx → .pdf rendering -----------------------
# LibreOffice version pinned to the exact Alpine community-repo build at
# image build time. Each release of LibreOffice rasterises slightly
# differently; pinning makes dossier sha256s reproducible across worker
# replicas and across rebuilds. The fonts the dossier template references
# are bundled here so a missing system font cannot silently substitute
# (which would shift every glyph and change the sha256).
ARG LIBREOFFICE_VERSION=24.2.6-r0
ARG LO_FONT_BUNDLE_VERSION=1.0.0
RUN apk add --no-cache \
    "libreoffice=${LIBREOFFICE_VERSION}" \
    "libreoffice-common=${LIBREOFFICE_VERSION}" \
    fontconfig \
    ttf-dejavu ttf-liberation ttf-opensans \
    msttcorefonts-installer && \
    update-ms-fonts && fc-cache -f
COPY infra/docker/dockerfiles/lo-fonts/ /usr/share/fonts/vigil/
RUN fc-cache -f
ENV LIBREOFFICE_VERSION=${LIBREOFFICE_VERSION} \
    LO_FONT_BUNDLE_VERSION=${LO_FONT_BUNDLE_VERSION} \
    SOURCE_DATE_EPOCH=1735689600

# CI reproducibility test: render a fixture .docx → .pdf and assert
# sha256 == known good. Lives in the worker image so nightly soak runs
# can re-verify without a separate test harness.
COPY infra/docker/dockerfiles/lo-repro-test.sh /usr/local/bin/lo-repro-test
RUN chmod 0755 /usr/local/bin/lo-repro-test

# Architect public key — copied at build time; the YubiKey-backed
# private side never enters the image. worker-dossier verifies its own
# signed dossiers against this trust anchor before delivery.
COPY --chown=vigil:vigil infra/host-bootstrap/architect-pubkey.asc /etc/vigil/architect-pubkey.asc

# gpg-agent socket from the host — bind-mounted at runtime via
# docker-compose so the YubiKey-backed private key signs dossiers
# without ever materialising a private key inside the container.
ENV GNUPGHOME=/run/vigil/gnupg
RUN mkdir -p /run/vigil/gnupg && chown vigil:vigil /run/vigil/gnupg && chmod 0700 /run/vigil/gnupg
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
