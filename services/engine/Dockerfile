# Ringcut audio engine
#
# Contains the only two things a Cloudflare Worker cannot run: yt-dlp and ffmpeg.
# No npm dependencies — the service is plain Node ESM.
FROM node:22-bookworm-slim

RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      ffmpeg \
      python3 \
      python3-pip \
      ca-certificates \
 && pip3 install --no-cache-dir --break-system-packages -U yt-dlp \
 && apt-get clean \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY server.mjs ./
COPY src ./src

ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=8788 \
    WORK_DIR=/data/work \
    MAX_PARALLEL=2

RUN useradd --system --shell /usr/sbin/nologin --home /app ringcut \
 && mkdir -p /data/work \
 && chown -R ringcut:ringcut /data /app

USER ringcut

EXPOSE 8788

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:8788/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server.mjs"]
