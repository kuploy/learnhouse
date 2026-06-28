# Live Classrooms — local PoC

Run live classrooms locally to iterate on the app code. Two paths: **from
source** (fastest feedback) or **local Docker** (closer to prod). Neither uses
STUNner, so media connects host/direct on localhost — you validate the app, not
the TURN relay. For the real relay, use the
[kuploy template](./kuploy-template.md).

> The feature code lives in the fork. Note that `npx learnhouse dev` and the
> upstream `ghcr.io/learnhouse/app` image **do not** contain it — you must run
> the fork's source or the fork image `ceduth/learnhouse-app`.

## 0. A throwaway LiveKit (both paths)

```bash
docker run --rm \
  -p 7880:7880 -p 7881:7881 -p 7882:7882/udp \
  livekit/livekit-server --dev
```

`--dev` boots LiveKit with the well-known dev keypair **`devkey` / `secret`**.
So the two values LearnHouse needs are:

```
LIVEKIT_KEYS=devkey:secret
LIVEKIT_URL=ws://localhost:7880
```

## Path A — from source

Bring up Postgres (pgvector) + Redis, then run the two apps from the fork
checkout. The non-LiveKit env mirrors the
[`learnhouse` template](https://github.com/kuploy/kuploy-templates/blob/main/templates/learnhouse/stack.yaml)
— that file is the source of truth for the full env set.

```bash
# deps
docker run -d --name lh-pg  -e POSTGRES_PASSWORD=lh -p 5432:5432 pgvector/pgvector:pg16
docker run -d --name lh-rds -p 6379:6379 redis

# backend (apps/api) — add the two LiveKit vars to the usual app env
cd apps/api
export LEARNHOUSE_SQL_CONNECTION_STRING="postgresql://postgres:lh@localhost:5432/postgres"
export LEARNHOUSE_REDIS_CONNECTION_STRING="redis://localhost:6379"
export LEARNHOUSE_AUTH_JWT_SECRET_KEY="dev-secret-at-least-32-chars-long-xxxx"
export LIVEKIT_KEYS="devkey:secret"
export LIVEKIT_URL="ws://localhost:7880"
uv run uvicorn app:app --reload --port 9000

# frontend (apps/web) — point it at the local API
cd apps/web
export NEXT_PUBLIC_LEARNHOUSE_API_URL="http://localhost:9000/api/v1/"
bun install && bun run dev
```

Then log in, create a course + lesson, and open
`/orgs/<org>/course/<courseuuid>/live` (optionally `?activity=<uuid>`,
`?board=<boarduuid>`, `?audio=1`).

## Path B — local Docker (the fork image)

Run the published fork image alongside LiveKit + deps. Minimal compose:

```yaml
# compose.poc.yaml
services:
  livekit:
    image: livekit/livekit-server:v1.13.1
    command: --dev
    ports: ["7880:7880", "7881:7881", "7882:7882/udp"]
  postgres:
    image: pgvector/pgvector:pg16
    environment: { POSTGRES_PASSWORD: lh }
  redis:
    image: redis
  learnhouse:
    image: ceduth/learnhouse-app:main   # the fork image (live-classrooms code)
    depends_on: [postgres, redis, livekit]
    ports: ["8080:80"]                  # nginx fronts web/api/collab on :80
    environment:
      LEARNHOUSE_SQL_CONNECTION_STRING: postgresql://postgres:lh@postgres:5432/postgres
      LEARNHOUSE_REDIS_CONNECTION_STRING: redis://redis:6379
      LEARNHOUSE_REDIS_URL: redis://redis:6379
      LEARNHOUSE_AUTH_JWT_SECRET_KEY: dev-secret-at-least-32-chars-long-xxxx
      NEXTAUTH_SECRET: dev-secret-at-least-32-chars-long-xxxx
      COLLAB_INTERNAL_KEY: dev-secret-at-least-32-chars-long-xxxx
      LEARNHOUSE_INITIAL_ADMIN_EMAIL: admin@lms.example.com
      LEARNHOUSE_INITIAL_ADMIN_PASSWORD: change-me-12345678
      LEARNHOUSE_DOMAIN: localhost:8080
      NEXT_PUBLIC_LEARNHOUSE_API_URL: http://localhost:8080/api/v1/
      # the two values the kuploy template would inject:
      LIVEKIT_KEYS: devkey:secret
      LIVEKIT_URL: ws://localhost:7880
```

```bash
docker compose -f compose.poc.yaml up
```

(Mirror the full env from the `learnhouse` template if the app needs more.)

## What this proves — and doesn't

| ✅ Validated locally | ❌ Not validated locally |
|---|---|
| Token endpoint authorizes + signs a join token | STUNner TURN relay (`connectionType:"turn"`) |
| Room UI: video grid beside the Board | Behaviour on UDP-blocked networks |
| Audio-only (camera off), per-lesson rooms | Per-tenant media wiring (kuploy server) |

For the relay path, deploy the [kuploy template](./kuploy-template.md).
