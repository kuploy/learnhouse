Pattern: lead-writer, lead = lead

# Claude operating rules for this repo

The account rules are the default. This file holds only what differs here.

## Who clears a branch

The `Pattern:` line above names the lead, and the lead clears a branch on this repo.
Before it landed there was no `CLAUDE.md` here at all, so every branch had to go to Ed
by hand — which is what it is for. Ask the lead, not Ed.

Branch shape: `feat/<role>/<issue>-slug`. One open branch per writer.

## Git workflow

Branch off `dev`, PR into `dev`, merge once it has two reviews. `dev` -> `main` is a
promotion and only Ed asks for one. Never release from `dev`.

## CI

GitHub Actions does run on this repo, unlike kuploy-cloud and kuploy core, so let the
workflows be the green rather than posting local checks in their place.
