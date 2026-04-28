# syntax=docker/dockerfile:1.7
# VIGIL APEX Python worker image — generic for any apps/worker-*-py app.
#
# Stages:
#   1. base       — Python 3.12 slim + GDAL/OpenCV system deps
#   2. builder    — install vigil-common + the worker package into a venv
#   3. runtime    — non-root, read-only fs where possible, dumb-init PID 1
#
# Build args:
#   APP_NAME   — folder under apps/, e.g. worker-satellite
#   APP_MODULE — Python module to launch, e.g. vigil_satellite.main
#   EXTRA_APT  — space-separated apt packages required at runtime (e.g. tesseract-ocr)

ARG PYTHON_VERSION=3.12.6

# ============================================================================
# Stage 1 — base
# ============================================================================
FROM python:${PYTHON_VERSION}-slim-bookworm AS base
ENV DEBIAN_FRONTEND=noninteractive \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    PIP_NO_CACHE_DIR=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    TZ=Africa/Douala

RUN set -eux && \
    apt-get update && \
    apt-get install -y --no-install-recommends \
      ca-certificates \
      curl \
      dumb-init \
      tini \
      tzdata \
      libpcsclite1 \
      build-essential \
      pkg-config \
      libgdal-dev \
      gdal-bin \
      libproj-dev \
      proj-data \
      proj-bin \
      libgeos-dev \
      libtiff5-dev \
      libwebp-dev \
      libjpeg-dev \
      libpng-dev \
      zlib1g-dev \
      libopenblas-dev \
      libgl1 \
      libglib2.0-0 \
      libsm6 \
      libxrender1 \
      libxext6 && \
    cp /usr/share/zoneinfo/Africa/Douala /etc/localtime && \
    echo "Africa/Douala" > /etc/timezone && \
    rm -rf /var/lib/apt/lists/*

# ============================================================================
# Stage 2 — builder (installs deps into /opt/venv)
# ============================================================================
FROM base AS builder
ARG APP_NAME

WORKDIR /repo
COPY packages/py-common /repo/packages/py-common
COPY apps/${APP_NAME} /repo/apps/${APP_NAME}

RUN python -m venv /opt/venv
ENV PATH="/opt/venv/bin:$PATH"

# Install vigil-common first so its build is cached separately from the worker
RUN pip install --upgrade pip wheel setuptools && \
    pip install /repo/packages/py-common && \
    pip install /repo/apps/${APP_NAME}

# ============================================================================
# Stage 3 — runtime
# ============================================================================
FROM base AS runtime
ARG APP_NAME
ARG APP_MODULE

# Optional runtime apt extras (e.g. tesseract-ocr-fra for forensics). The
# default is empty; the docker-compose job sets EXTRA_APT per service.
ARG EXTRA_APT=""
RUN if [ -n "$EXTRA_APT" ]; then \
      apt-get update && \
      apt-get install -y --no-install-recommends $EXTRA_APT && \
      rm -rf /var/lib/apt/lists/*; \
    fi

# Non-root user
RUN groupadd -g 1000 vigil && useradd -u 1000 -g vigil -m -s /usr/sbin/nologin vigil

# Copy the venv from builder
COPY --from=builder --chown=vigil:vigil /opt/venv /opt/venv
ENV PATH="/opt/venv/bin:$PATH" \
    PYTHONPATH="/opt/venv/lib/python3.12/site-packages" \
    APP_MODULE=${APP_MODULE} \
    PROMETHEUS_PORT=9100

WORKDIR /app

# Healthcheck driven by the metrics endpoint each worker exposes
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD curl -fsS http://localhost:9100/healthz || exit 1

USER vigil
EXPOSE 9100

ENTRYPOINT ["/usr/bin/dumb-init", "--"]
# Use exec form via a shell that resolves $APP_MODULE — the value comes from build args
CMD ["sh", "-c", "exec python -m $APP_MODULE"]
