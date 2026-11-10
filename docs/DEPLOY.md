# Deploying the engine

The Worker is trivial to deploy; the engine is the part that needs a real machine because `ffmpeg` and
`yt-dlp` are native processes.

```
Internet ──▶ Cloudflare Worker (TLS, free) ──▶ engine :8788 (private, token-protected)
```

## 1. Requirements

- Linux x86_64 (or any OS with ffmpeg + yt-dlp), 1 vCPU, 512 MB RAM is enough for 40-second clips.
- `ffmpeg` with `libmp3lame` and the native `aac` encoder (Debian/Ubuntu `ffmpeg` package is fine).
- `yt-dlp` **recent** — YouTube changes weekly; run `yt-dlp -U` on a cron.

```bash
sudo apt update && sudo apt install -y ffmpeg python3-pip
sudo pipx install yt-dlp || pip install --break-system-packages -U yt-dlp
```

## 2. Run it

### Docker (recommended)

```bash
docker build -t ringcut-engine services/engine
docker run -d --restart unless-stopped --name ringcut-engine \
  -p 127.0.0.1:8788:8788 \
  -e HOST=0.0.0.0 -e PORT=8788 \
  -e ENGINE_TOKEN="$(openssl rand -hex 24)" \
  -e MAX_PARALLEL=2 \
  -v "$PWD/data:/data" \
  ringcut-engine
```

`-p 127.0.0.1:8788:8788` keeps the port off the public internet. Reach it from the Worker through a
Cloudflare Tunnel instead of opening a firewall hole.

### systemd (no Docker)

```ini
# /etc/systemd/system/ringcut-engine.service
[Unit]
Description=Ringcut audio engine
After=network-online.target

[Service]
WorkingDirectory=/opt/ringcut/services/engine
Environment=HOST=127.0.0.1
Environment=PORT=8788
Environment=ENGINE_TOKEN=replace-me
Environment=MAX_PARALLEL=2
Environment=WORK_DIR=/var/lib/ringcut/work
ExecStart=/usr/bin/node server.mjs
Restart=always
RestartSec=2
User=ringcut
NoNewPrivileges=true
PrivateTmp=true

[Install]
WantedBy=multi-user.target
```

```bash
sudo useradd -r -s /usr/sbin/nologin ringcut
sudo mkdir -p /var/lib/ringcut/work && sudo chown -R ringcut /var/lib/ringcut
sudo systemctl enable --now ringcut-engine
curl -s localhost:8788/api/health
```

## 3. Expose it to the Worker

Workers can only reach public HTTPS, so pick one:

**Cloudflare Tunnel (no inbound ports):**

```bash
cloudflared tunnel create ringcut
cloudflared tunnel route dns ringcut engine.example.com
cloudflared tunnel run --url http://127.0.0.1:8788 ringcut
```

Then set `ENGINE_URL = "https://engine.example.com"` in `apps/api/wrangler.toml`.

**Or Caddy in front of it:**

```
engine.example.com {
  reverse_proxy 127.0.0.1:8788
}
```

> Always keep `ENGINE_TOKEN` set. Without it the engine refuses to bind a non-loopback address, and
> with it every request must carry `x-engine-token`. Put the token in `wrangler secret put ENGINE_TOKEN`
> and in the engine environment — never in the repo.

## 4. YouTube on a datacenter IP

YouTube frequently answers cloud IPs with *"Sign in to confirm you're not a bot"*. The API surfaces this
as `BOT_CHECK`. Options, in order of practicality:

1. **Cookies from a throwaway account** (best results):
   ```bash
   # export cookies.txt with a browser extension, then
   -e YTDLP_COOKIES=/data/cookies.txt
   ```
   Cookies expire; refresh them when `BOT_CHECK` returns.

2. **Residential/ISP proxy**:
   ```bash
   -e YTDLP_PROXY=http://user:pass@host:port
   ```

3. **Different player client**:
   ```bash
   -e YTDLP_EXTRA_ARGS="--extractor-args youtube:player_client=android"
   ```

Keep `yt-dlp` current — most extraction failures are fixed upstream within days.

## 5. Sizing and cost

| Piece | Free tier | Notes |
| --- | --- | --- |
| Worker + static assets | 100k req/day, 10 ms CPU | Relay only; streaming does not burn CPU. |
| KV (optional, rate limit) | 100k reads/day | Without it, limits are per-isolate. |
| Engine | not on Cloudflare | ~$0 on an existing VPS, or a small container host. |

A 30 s MP3 render costs roughly 1–2 s of CPU. Two concurrent renders (`MAX_PARALLEL=2`) saturate a
1 vCPU box — keep it at 1 on 512 MB machines.

## 6. Operations

- `GET /api/health` returns `{ok, capabilities:{ffmpeg, ffprobe, ytdlp}, uptimeSec, limits}`.
- Files live in `WORK_DIR` (`/tmp/ringtone-engine` by default) and are deleted by a 30 s sweeper after
  `FILE_TTL_MS` (15 min). Nothing else is persisted.
- Restarting the engine drops in-flight jobs and cached audio; the SPA reports `SOURCE_EXPIRED` and lets
  the user paste the link again.
- Log lines are one per request: `POST /api/convert 202 41ms`.
