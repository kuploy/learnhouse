Pattern: lead-writer, lead = lead

# Claude operating rules for this repo

The account rules are the default. This file holds only what differs here.

## Who clears a branch

The `Pattern:` line above names the lead, and the lead clears a branch on this repo.
Before it landed there was no `CLAUDE.md` here at all, so every branch had to go to the
owner by hand — which is what the line is for. Ask the lead.

Branch shape: `feat/<role>/<issue>-slug`. One open branch per writer.

**This changes the names that worked here.** PRs #35, #38, #40, #41 and #44 all opened
`feat/lead/<issue>-slug`, and under `lead-writer` the lead does not write code, so that
prefix will no longer open a branch. A session writing here opens `feat/writer/<issue>-slug`.
Branches already pushed in the old shape are not renamed and still push as they are.

## Git workflow

Branch off `dev`, PR into `dev`, merge once it has two reviews. `dev` -> `main` is a
promotion and only the owner asks for one. Never release from `dev`.

## CI

**No GitHub Actions job runs here, so never wait for an Actions check.** Other checks do
still post and still have to go green — a `two-reviews` status appears on every PR.

The workflow files are untouched and GitHub still reports Actions as enabled, both on the
settings page and from `GET /actions/permissions`, so neither tells you anything. What
tells you is a commit that should have triggered a build — a PR head, or a push to `dev`
or `main` — ending up with zero runs against it. A dispatch is refused outright
(`HTTP 422: Actions has been disabled for this repository.`), but there is no need to try
one, and do not: if Actions ever comes back, dispatching one of the publish workflows
pushes an image.

Local checks are the green, as the account rules describe: run what the jobs covering your
change would run, then post the commands, the commit they ran on and the results as a PR
comment. That comment is the green.

**Nothing is published either.** A push to `main` used to build the app and docs images
and push them to Docker Hub, and it no longer does, so a published tag can sit behind
`main` indefinitely. A local check cannot stand in for a publish; ask the owner how to
ship.
