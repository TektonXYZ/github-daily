# github-daily

An agent skill that open-sources the safe half of your projects, one a day.

## The idea

Most of what a solo builder ships never leaves a private folder, because the front end is tangled up with keys, wallets and server code. This skill pulls the front end out, proves it is clean, and publishes it as a new repo with real commits. Your work shows up in public, and nothing that should stay private goes with it.

## How it stays safe

- **Keep list, not a block list.** Only known front-end folders are copied. Anything unknown stays behind.
- **Backends stay home.** API routes, server code, admin pages and env files are left out.
- **Placeholders.** Addresses, RPC links, emails and private paths are swapped out.
- **Two scans.** Its own checks and [gitleaks](https://github.com/gitleaks/gitleaks) both have to pass, or the project is skipped.
- **Fresh history.** A project's old commits never go up.
- **Honest dates.** No backdating and no empty commits.

## Use it

Copy this folder into your skills directory, then create `~/github-daily/settings.json`:

```json
{
  "owner": "your-github-name",
  "author": "Your Name",
  "email": "your GitHub noreply address",
  "swaps": [["/home/you", "~"], ["Your Name", "the team"]],
  "neverPublish": ["folder-to-skip"]
}
```

```bash
node prepare.mjs ~/my-project my-project   # scrub and check, nothing goes online
node publish.mjs --dry-run                 # see what would happen
node publish.mjs                           # publish the next approved project
node test.mjs                              # plant secrets and prove none survive
```

`SKILL.md` has the full steps. Needs Node, the GitHub CLI and gitleaks.
