# Live Classrooms — runbook

Real-time video/audio on a lesson, rendered beside a collaborative LearnHouse
Board. Media rides a [LiveKit](https://livekit.io) SFU; LearnHouse only signs
the room **join tokens**. There are two ways to run it.

> **TL;DR validation caveat:** the local PoC proves the *app code* works (token
> endpoint, room UI, video next to the Board). It does **not** exercise the
> production media relay. Only the kuploy stack routes media through the shared
> STUNner TURN gateway (`connectionType:"turn"`). A green PoC ≠ proven on every
> network.

## 🚀 The way to ship it — the kuploy one-click template *(recommended)*

Deploy the **`learnhouse-live`** composite stack from
[kuploy-templates](https://github.com/kuploy/kuploy-templates/tree/main/templates/learnhouse-live):
one click co-deploys LearnHouse **and** a LiveKit SFU and auto-wires the
credentials between them — no env juggling, and the media relay is set up for
you. This is the productized path on [kuploy](https://kuploy.app).

→ **[kuploy-template.md](./kuploy-template.md)**

## 🧪 The fast way to hack on it — local PoC

Run LearnHouse from source (bun + uvicorn) or as a local container, against a
throwaway LiveKit, to iterate on the token endpoint and room UI. Quick, but it
does not reproduce the TURN relay.

→ **[dev-poc.md](./dev-poc.md)**

## How it works (the short version)

1. Browser opens a lesson's live page → calls `POST /api/v1/live/token`.
2. The FastAPI backend authorizes the user against the course, signs a
   short-lived LiveKit **join token** with `LIVEKIT_KEYS`, and returns it with
   the public `wss://` URL (`LIVEKIT_URL`).
3. The browser connects to LiveKit with that token via
   `@livekit/components-react` and renders the video grid beside the Board.

The two values (`LIVEKIT_KEYS`, `LIVEKIT_URL`) are injected server-side. In the
kuploy template they come from a stack connection to the LiveKit component; in
the PoC you set them by hand.

## Security & architecture

LearnHouse holds **`LIVEKIT_KEYS` only**; the api-secret never reaches the
browser, and no STUNner/TURN credential is ever involved on the client. Full
model in **[../../notes/live-classrooms.md](../../notes/live-classrooms.md)**.

## Location & map

This runbook lives at `docs/runbooks/live-classrooms/`:

```
docs/
├─ notes/
│  └─ live-classrooms.md          architecture + security model
└─ runbooks/
   └─ live-classrooms/
      ├─ README.md                you are here — entry point
      ├─ dev-poc.md               local PoC: from-source + Docker
      └─ kuploy-template.md       deploy via the kuploy template (recommended)
```

How the docs link together:

```
README.md
   ├─ 🚀 ship it      ──►  kuploy-template.md  ──►  kuploy.app + templates/learnhouse-live
   ├─ 🧪 hack on it   ──►  dev-poc.md          ──►  throwaway `livekit --dev`
   └─ security/arch   ──►  ../../notes/live-classrooms.md
```
