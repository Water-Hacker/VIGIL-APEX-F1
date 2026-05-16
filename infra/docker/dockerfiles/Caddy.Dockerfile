# Custom Caddy build with the rate-limit module compiled in.
# Pinned digest discipline per SRD §3.4 — the operator updates the digest
# in this file and the SBOM scanner re-runs.
FROM caddy:2.11.3-builder@sha256:f96a3b748f2ce4e5f6595453615da734b93993b231213fe35d0673893b5613ef AS builder
RUN xcaddy build \
    --with github.com/mholt/caddy-ratelimit

FROM caddy:2.11.3-alpine@sha256:86deaf5e3d3408a6ccec08fbb79989783dd26e206ae10bcf78a801dc8c9ab794
COPY --from=builder /usr/bin/caddy /usr/bin/caddy
