# Contributing

## Setup

```sh
git clone git@github.com:edugargar/spoochie.git && cd spoochie
bun install --frozen-lockfile
git config core.hooksPath .githooks   # leak check before every push
bun test
```

Tests isolate all state under a temporary `SPOOCHIE_HOME`; they never touch your real
`~/.claude/spoochie`. Two suites start real daemons (`tests/dos-maquinas*.test.ts`) and
take a few seconds.

## How changes land

`main` is protected: no force pushes, no deletions, linear history, and every commit
must arrive through a pull request whose checks (tests on Linux and macOS, leak check)
are green. That applies to the maintainer too.

- One mechanism per commit, with the before and after in the message. A fix says what
  was observed, what was expected, and what changed. "Fix bug" is not a message.
- A test for every behaviour that a person could notice. A red test is a question, not
  a verdict: read the assertion and say which of the two is wrong before touching it.
- Nothing that identifies a person or a company that is not this project: no teammate
  names, no employer, no Slack ids, no internal app names. The leak check enforces the
  generic part; the private word list enforces the rest.
- Write in the same register as the code around you. Comments explain why, not what.

## Versions

Versions follow `MAJOR.MINOR.PATCH`. Before 1.0, MINOR can change the protocol between
daemons; the envelope carries the sender's version and `doctor` tells both sides when
they differ. PATCH is bug fixes only.

The 0.9 line is frozen for features until a spoochie with an attached file has been
exchanged between two different machines over Nostr, by two different people, with
screenshots. Until then, only fixes go in.

## Releasing

```sh
bun scripts/version.ts X.Y.Z "One line for the CHANGELOG"
# edit CHANGELOG.md if the line needs company, then:
git commit -am "X.Y.Z: ..." && git tag vX.Y.Z && git push origin main vX.Y.Z
```

The tag triggers the release workflow: it builds four binaries with `bun build
--compile`, writes `SHA256SUMS`, and attaches them to the GitHub release. The session
hook on every machine downloads `spoochie-<version>` for its platform and refuses it if
the checksum does not match. Tags are protected: a released version is never rebuilt
under the same tag.
