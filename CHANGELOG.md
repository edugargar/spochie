# Changelog

## 0.8.0 (2026-09-04)

- Outgoing messages are queued on disk and resumed after a daemon restart; failed publishes retry every minute. Side windows are re-attached after a restart.
- The Claude on the side works on a clean `git worktree` copy of the repo, never on your checkout (`spoochie config --copia off` to change that).
- Every envelope carries the sender's version; the newer side says once in the thread when the other is behind. `spoochie --version`.
- A message the guardian could not judge is delivered labelled `sin vigilar`, in the session and in the thread.
- The daemon checks the latest release every 6 hours and mentions a newer one; `doctor` shows version, side-Claude mode and the outbox.
- Our own mascot (docs/spoochie.svg) instead of Poochie's picture.
- `CHANGELOG.md`, one version source (`bun scripts/version.ts`), tests on every push on Linux and macOS, and the Slack app as a manifest (`docs/slack-app-manifest.yml`).

## 0.7.1 (2026-09-04)

- The thread of a spoochie you open lives in a group DM (bot + both people). `--hilos canal|dm` for the alternatives. Needs `mpim:*` scopes; falls back to the receiver's DM without them.
- Transcript Artifact documented as off by default.

## 0.7.0 (2026-09-04)

- An incoming spoochie is a macOS dialog (with the mascot), not a turn in the terminal you work in. "Que pase" opens the side window; "Ahora no" rejects; "Ver en Slack" opens the thread.

## 0.6.4 (2026-09-04)

- `say` waits up to 8 s for the real Slack publish and says `publicado`; the silence notice lists facts instead of letting the Claude guess.

## 0.6.3 (2026-09-04)

- The Claude on the side publishes the transcript of incoming spoochies (when the transcript is on).

## 0.6.2 (2026-09-04)

- The side window runs in `auto` permission mode with a deny list (Edit, Write, git push/commit/checkout/reset, rm) and knows about rtk-rewritten commands.

## 0.6.1 (2026-09-04)

- `/spoochie:join` no longer asks for Bun.

## 0.6.0 (2026-09-04)

- Renamed to Spoochie everywhere. State moves from `~/.claude/spochie` on first start; the old launchd agent is removed.

## 0.5.4 (2026-09-02)

- Security audit fixes: envelope thread ids validated, contact names can't take over another id, the downloaded binary is the plugin's version and is verified against `SHA256SUMS`, `git branch` limited to `--list`.

## 0.5.3 (2026-09-02)

- The inbox poll adapts to the team size, 5 s floor.

## 0.5.2 (2026-09-02)

- The invitation goes to one session with the question in it; the Claude on the side opens in a new terminal window; interactive sessions see nothing more.
