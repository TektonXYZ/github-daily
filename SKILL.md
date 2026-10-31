---
name: github-daily
description: Use when publishing projects to GitHub as open source, adding a project to the daily publish queue, filling the GitHub contribution graph with real work, or when someone says "github daily".
---

# GitHub Daily

Publishes one project's front end and a short idea write-up to a new public repo each day. Rules live in `checks.mjs`, so a project either passes or gets skipped.

## Folders

Private, never published: `~/github-daily/`
- `settings.json`: owner, author, noreply email, `swaps`, `neverPublish`
- `write-ups/<repo>.md`: becomes the repo's README
- `ready/<repo>/`: scrubbed copy
- `reports/<repo>.md`: what was kept, swapped and left out
- `queue.json`: approved list, `[{ "name": "...", "description": "..." }]`
- `published.json`, `skipped.json`: logs
- `PAUSE`: if this file exists, the daily job does nothing

## Add a project

1. Run `node prepare.mjs <project-folder> <repo-name>`. Fix or skip anything under "Final check" in the report.
2. Read the report. Imports that point at nothing mean a screen depended on server code; keep the project only if the main screens still work.
3. Write `write-ups/<repo>.md` in this shape, then run prepare again:
   - one-line pitch
   - the idea, in a short plain paragraph
   - the main screens
   - "Front end only. The backend, wallets and live data are not in this repo, and every address is a placeholder."
   - how to run it, and a link to the live site if there is one
4. Add it to `queue.json` once the owner has approved that project or batch.

To scrub everything at once, run `node batch.mjs <projects-folder>`. It writes `candidates.json` and keeps only the clean projects in `ready/`. A held project has imports that point at nothing, so fix those screens before it goes out.

## Write-up rules

Keep it vague. Leave out fee percentages, wallet logic, treasury numbers, coin addresses, launch dates and partner names, and do not claim ties to any real person or company.

## Daily job

`node publish.mjs` runs once a day. It re-checks a project, runs gitleaks, and splits it into small commits, one per page or component. Each day it releases a different number of those commits, moving on to the next project when one runs out. It never touches a repo that already exists. Use `--dry-run` to see what it would do.

Set it up with `launchd` on the machine that holds `ready/`. Stop it with `touch ~/github-daily/PAUSE`.

## Never

- Change commit dates or make empty commits.
- Publish a project's own git history.
- Publish code from a project on `neverPublish`, or third-party code.
