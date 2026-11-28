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

GitHub Actions runs on this repo, so let the workflows be the green.

**API Lint is the known exception.** It has been failing on `dev` itself since before
this file (`6430f9c` and earlier), so it is red for reasons a PR did not cause. While
that is true, run what that job runs and post the commands, the commit and the results
as a PR comment, and let that comment stand in for it. Every other job still has to pass.
