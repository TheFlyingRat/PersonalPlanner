# Deploying Cadence

Cloudflare Pages (free static hosting) + your VPS (API + PostgreSQL).

```
          cadence.dev ──► Cloudflare Pages (landing)     FREE
      app.cadence.dev ──► Cloudflare Pages (web app)     FREE
      api.cadence.dev ──► Cloudflare proxy ──► nginx ──► localhost:3000
```

---

## 1. VPS — API + Database

```bash
git clone https://github.com/your-org/cadence.git /opt/cadence
cd /opt/cadence
cp .env.example .env
```

Edit `.env` with your production values:

```env
DATABASE_URL=postgresql://cadence:YOUR_DB_PASSWORD@postgres:5432/cadence
POSTGRES_PASSWORD=YOUR_DB_PASSWORD
GOOGLE_CLIENT_ID=your-id.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=your-secret
GOOGLE_REDIRECT_URI=https://api.cadence.dev/api/auth/google/callback
JWT_SECRET=<openssl rand -hex 32>
JWT_REFRESH_SECRET=<openssl rand -hex 32>
ENCRYPTION_KEY=<openssl rand -hex 32>
CORS_ORIGIN=https://app.cadence.dev,https://cadence.dev
SMTP_HOST=<your smtp host>
SMTP_PORT=587
SMTP_USER=<your smtp user>
SMTP_PASS=<your smtp pass>
SMTP_FROM=Cadence <noreply@yourdomain.com>
```

Launch:

```bash
docker compose up -d
```

Verify: `curl http://localhost:3000/api/health`

### Expose via Cloudflare Tunnel (free SSL, no nginx needed)

```bash
# Install cloudflared on VPS
curl -fsSL https://pkg.cloudflare.com/cloudflare-main.gpg | gpg --dearmor -o /usr/share/keyrings/cloudflare.gpg
echo "deb [signed-by=/usr/share/keyrings/cloudflare.gpg] https://pkg.cloudflare.com/cloudflared $(lsb_release -cs) main" > /etc/apt/sources.list.d/cloudflared.list
apt update && apt install -y cloudflared

cloudflared tunnel login
cloudflared tunnel create cadence-api

cat > /etc/cloudflared/config.yml << 'EOF'
tunnel: <tunnel-id>
credentials-file: /root/.cloudflared/<tunnel-id>.json

ingress:
  - hostname: api.cadence.dev
    service: http://localhost:3000
  - service: http_status:404
EOF

cloudflared service install
systemctl enable --now cloudflared
```

Add DNS record: `api.cadence.dev CNAME <tunnel-id>.cfargotunnel.com` (proxied).

---

## 2. Cloudflare Pages — Landing Site

Cloudflare Dashboard → Workers & Pages → Create → Connect GitHub repo.

| Setting | Value |
|---------|-------|
| Project name | `cadence-landing` |
| Production branch | `master` |
| Build command | `cd packages/landing && pnpm install && pnpm build` |
| Build output | `packages/landing/build` |

Environment variables:

| Variable | Value |
|----------|-------|
| `VITE_APP_URL` | `https://app.cadence.dev` |
| `NODE_VERSION` | `22` |

Set custom domain: `cadence.dev`

---

## 3. Cloudflare Pages — Web App

Same flow, second Pages project:

| Setting | Value |
|---------|-------|
| Project name | `cadence-app` |
| Production branch | `master` |
| Build command | `cd packages/shared && pnpm install && pnpm build && cd ../web && pnpm install && pnpm build` |
| Build output | `packages/web/build` |

Environment variables:

| Variable | Value |
|----------|-------|
| `PUBLIC_API_URL` | `https://api.cadence.dev/api` |
| `NODE_VERSION` | `22` |

Set custom domain: `app.cadence.dev`

SPA routing works automatically — `adapter-static` uses `fallback: 'index.html'`.

---

## 4. Google OAuth

1. [Google Cloud Console](https://console.cloud.google.com/apis/credentials) → Create OAuth 2.0 credentials
2. Redirect URI: `https://api.cadence.dev/api/auth/google/callback`
3. JS origins: `https://app.cadence.dev`
4. Enable Google Calendar API

---

## 5. Production Notes

### Environment Variables

- **`ENCRYPTION_KEY`** must be exactly 64 hex characters (`openssl rand -hex 32`).
- **`FRONTEND_URL`** should point to your web app origin (e.g., `https://app.cadence.dev`). Used for email links and CORS.
- **`TRUST_PROXY`** set to `true` when running behind a reverse proxy (nginx, Cloudflare Tunnel, etc.) so Express reads `X-Forwarded-*` headers correctly.

### Build Preparation

Before running type-checking on the web package, run `pnpm prepare` (or `pnpm exec svelte-kit sync`) to generate the `.svelte-kit/tsconfig.json` that the web tsconfig extends.

### Structured Logging

The API currently uses `console.log`/`console.error`. For production, consider adopting a structured logging library such as [pino](https://github.com/pinojs/pino) to get JSON logs with levels, timestamps, and request context.

---

## 6. Updates & Backups

```bash
# Update
cd /opt/cadence && git pull && docker compose up -d --build cadence

# DB backup (add to crontab for daily)
docker exec cadence-postgres-1 pg_dump -U cadence cadence | gzip > /backups/cadence-$(date +%F).sql.gz
```
