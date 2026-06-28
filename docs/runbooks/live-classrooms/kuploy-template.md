# Live Classrooms — the kuploy template (production)

The productized path: deploy the **`learnhouse-live`** composite stack on
[kuploy](https://kuploy.app). One click co-deploys LearnHouse + a LiveKit SFU,
auto-wires the credentials between them, and sets up the media relay — nothing
to copy by hand.

Template:
[`kuploy-templates/templates/learnhouse-live`](https://github.com/kuploy/kuploy-templates/tree/main/templates/learnhouse-live)

## Prerequisites

- A **kuploy server built from `dev`** (≥ the stack-connection passthrough,
  kuploy#86). Without it the `env:LIVEKIT_KEYS` / `wsUrl` connection fields don't
  resolve and the token endpoint returns `503`.
- An **amd64** cluster (the published image is amd64 — see *Where the image
  comes from* below).
- The shared **STUNner** media gateway installed (kuploy-k8s#30/#34) so media
  relays automatically.

## Deploy

1. Import / deploy **`learnhouse-live`** as its **own project** (provision
   mode). Deploy it standalone rather than into a namespace that already has a
   `livekit-server` — the template brings its own, and two would collide.
2. Provisioning creates and wires, with no manual edits:
   - `learnhouse-app` → image `ceduth/learnhouse-app:main`, gets a domain.
   - `livekit-server` → generates `LIVEKIT_KEYS`, gets a domain.
   - `learnhouse-postgres` (pgvector), `learnhouse-redis`.
   - Connections into `learnhouse-app` (server-side, never the browser):

     | LearnHouse env | From | Field |
     |---|---|---|
     | `LIVEKIT_KEYS` | `livekit-server` | `env:LIVEKIT_KEYS` |
     | `LIVEKIT_URL`  | `livekit-server` | `wsUrl` |
3. The kuploy server auto-wires the media path for the new `livekit-server`
   (injects the TURN block into `LIVEKIT_CONFIG` + a per-tenant `UDPRoute`).

## Verify

1. Wait for `learnhouse-app` and `livekit-server` pods to be ready.
2. Log in with `LEARNHOUSE_INITIAL_ADMIN_EMAIL` (default
   `admin@lms.example.com`) and the generated
   `LEARNHOUSE_INITIAL_ADMIN_PASSWORD` (from the app's managed env).
3. Create a course + lesson, open `/orgs/<org>/course/<courseuuid>/live`.
4. You should see the **video grid beside the Board**, joined as yourself, with
   the LiveKit connection reporting **`connectionType:"turn"`** (media relayed
   via STUNner).
5. Sanity: grep the running LearnHouse env/code — there must be **no** STUNner
   shared secret and **no** minted TURN credential. Only `LIVEKIT_KEYS`.

## Known limitation

Browser↔STUNner relay is **UDP/3478 only** today; no TLS/TCP fallback until
TURN-over-TLS (kuploy-k8s#35). On a UDP-blocked network the client can't connect
— a success on one permissive network doesn't prove every network.

## Where the image comes from

`ceduth/learnhouse-app` is built from this fork and pushed to Docker Hub by the
`publish-live-classrooms-image.yaml` workflow on every push to `main` that
touches `apps/**` or the `Dockerfile` (amd64). You don't need to build it to
deploy the template — the tag is already published.
