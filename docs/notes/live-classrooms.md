# Live Classrooms

Live classrooms add real-time video/audio to a lesson, rendered beside a
LearnHouse Board. Media is carried by a LiveKit SFU; LearnHouse only signs the
room **JOIN tokens** — it does not touch the media path.

> This note is the **architecture + security** reference. To actually run or
> deploy the feature, see the runbook:
> [`docs/runbooks/live-classrooms/`](../runbooks/live-classrooms/README.md)
> (local PoC + the kuploy template).

## How it works

1. The browser opens `/orgs/<org>/course/<courseuuid>/live` (optionally
   `?activity=<activityuuid>` to scope the room to one lesson, `?board=<uuid>`
   to render a Board beside the video, `?audio=1` to join with the camera off).
2. The frontend calls `POST /api/v1/live/token` with the course (and optional
   lesson). The backend authorizes the caller against the course, then mints a
   short-lived LiveKit JOIN token and returns it together with the public
   `wss://` signalling URL.
3. The client connects to LiveKit with that token via
   `@livekit/components-react`.

The room name is the activity uuid when supplied, otherwise the course uuid.
Both instructors (course write access) and learners may publish, so the class
is interactive; the user's role is attached to the token as participant
metadata.

## Configuration

Two values are injected into the backend env by the kuploy stack-connection
primitive (you do **not** set these by hand):

| Env var        | Source connection field | Used for                                  |
|----------------|-------------------------|-------------------------------------------|
| `LIVEKIT_KEYS` | `env:LIVEKIT_KEYS`      | `apikey:apisecret` — signs JOIN tokens    |
| `LIVEKIT_URL`  | `wsUrl`                 | public `wss://` URL handed to the browser |

If either is missing the token endpoint returns `503` and the feature is simply
unavailable — nothing else in LearnHouse is affected.

## Security model

Three different secrets exist across the stack; **LearnHouse only ever sees
`LIVEKIT_KEYS`**.

- The LiveKit **api-secret** stays in the FastAPI backend. It is never a
  `NEXT_PUBLIC_*` var and is never shipped to the browser. The browser receives
  only the minted JOIN token (a JWT it cannot forge) plus the public URL. Leak
  the api-secret and anyone could mint a token for any room as any identity.
- The **STUNner shared secret** (HMAC key that mints TURN credentials) and the
  **minted TURN credential** (SFU↔STUNner media auth) live entirely in
  kuploy-server / the LiveKit pod. They never appear in LearnHouse
  code/env/browser. The browser needs no TURN credential: the SFU advertises
  its own relay candidates, so media relays through STUNner
  (`connectionType:"turn"`) without the client holding any TURN secret.

## Known limitation — UDP-blocked networks

Today the browser↔STUNner relay path is **UDP/3478 only**: there is no TLS/TCP
fallback yet (tracked in kuploy-k8s#35, TURN-over-TLS). On a network that blocks
outbound UDP, the client cannot establish the relay and will fail to connect.
A successful join on one permissive network therefore does **not** prove the
feature works on every network — validate on a restrictive network once
TURN-over-TLS lands.
