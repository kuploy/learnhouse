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
   - `learnhouse-app` → the fork's app image, gets a domain. The template may
     still pin the old Docker Hub copy; see *Where the images come from*.
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

## Where the images come from (and how to build them)

Two images on GitHub's registry back the template, both built from this fork
(amd64) and both public:

| Image | Described by |
|---|---|
| `ghcr.io/kuploy/learnhouse-app` | `publish-live-classrooms-image.yaml` |
| `ghcr.io/kuploy/learnhouse-docs` | `publish-docs-image.yaml` |

The earlier Docker Hub tags stay published, so a deploy pinned to one of those
digests keeps pulling until someone moves it on purpose. They get no new builds.

### Build and push (by hand for now)

GitHub Actions is off on this repository, so neither workflow runs and a merge
to `main` publishes nothing. Until it is back on, push by hand. You need a token
that can write the org's packages:

```bash
docker login ghcr.io -u <github-user> --password-stdin < <token-file>
```

From a clean checkout of the commit you want to publish:

```bash
TAG=main-$(git rev-parse --short=7 HEAD)
# app image
docker buildx build --platform linux/amd64 --build-arg LEARNHOUSE_PUBLIC=true \
  -t ghcr.io/kuploy/learnhouse-app:main -t ghcr.io/kuploy/learnhouse-app:$TAG --push .
# docs image
docker buildx build --platform linux/amd64 -f docs/Dockerfile \
  -t ghcr.io/kuploy/learnhouse-docs:main -t ghcr.io/kuploy/learnhouse-docs:$TAG --push ./docs
```

### Test a branch build (dev / troubleshooting)

To try an unmerged branch on a live deployment without merging to `main`, build
its image, point the deployment at it, then roll back to `:main`.

1. **Build + push the branch.** From a clean checkout of the branch, tag it
   `<branch>-<sha>` (replace any `/` in the branch name with `-`, e.g.
   `fix/foo` → `fix-foo`). Do not tag it `:main`:

   ```bash
   docker buildx build --platform linux/amd64 --build-arg LEARNHOUSE_PUBLIC=true \
     -t ghcr.io/kuploy/learnhouse-app:<branch>-<sha> --push .
   ```

2. **Point the deployment at the tag.** kuploy names the deployment
   `learnhouse-app-<hash>` in namespace `project-<org>`; find it with
   `kubectl -n <ns> get deploy | grep learnhouse-app`. Prefer the
   **sha-pinned** tag so the pull is unambiguous; `*=` sets every container:

   ```bash
   kubectl -n project-<org> set image deploy/learnhouse-app-<hash> \
     '*=ghcr.io/kuploy/learnhouse-app:<branch>-<sha>'
   kubectl -n project-<org> rollout status deploy/learnhouse-app-<hash>
   ```

   A fresh `-<sha>` tag always rolls the pod. A **floating** tag (`:<branch>`,
   `:main`) won't re-pull if the string is unchanged — force it with
   `kubectl -n project-<org> rollout restart deploy/learnhouse-app-<hash>`.

3. **Roll back to production** once done — re-pin `:main` (and restart, since
   the tag string is unchanged):

   ```bash
   kubectl -n project-<org> set image deploy/learnhouse-app-<hash> \
     '*=ghcr.io/kuploy/learnhouse-app:main'
   kubectl -n project-<org> rollout restart deploy/learnhouse-app-<hash>
   ```

> This `set image` is a **manual override** outside the kuploy stack spec. A
> dashboard **Redeploy** (or any stack reconcile) resets the image to whatever
> the spec pins — so it's for testing only, and rolling back to `:main` keeps
> the override and the spec in agreement. The same steps apply to
> `learnhouse-docs` (swap the deployment name and `ghcr.io/kuploy/learnhouse-docs`).
