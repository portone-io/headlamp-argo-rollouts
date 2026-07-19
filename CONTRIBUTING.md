# Contributing

Thanks for your interest in `headlamp-argo-rollouts`. This plugin started as a
proof-of-concept at [PortOne](https://portone.io) and is shared as-is (see the
[Status & support](./README.md#status--support) note), but contributions and
forks are welcome.

## Development

Requires Node.js 20+ and npm.

```bash
npm install
npm run start   # run against a local Headlamp
npm run tsc     # type check
npm run lint    # eslint (use `npm run lint-fix` to autofix)
npm run test    # vitest unit tests
npm run i18n    # re-extract the translation catalog (locales/)
npm run build   # produce dist/main.js
npm run package # produce the distributable <name>-<version>.tar.gz (+ sha256)
```

Before opening a PR, please make sure `npm run tsc`, `npm run lint`, and
`npm run test` all pass. CI runs the same steps.

### i18n

User-facing strings go through the SDK's `useTranslation()` hook — natural
English is the key, e.g. `t('Rollback')` or `t('Set image: {{name}}', { name })`.
Add new strings as **literal** `t('…')` calls (not a variable lookup) so
`i18next-parser` can extract them, then run `npm run i18n` to update
`locales/en/translation.json` and commit it. CI fails if the catalog is stale.
Add a locale with `npm run i18n <locale>` (e.g. `npm run i18n ko`).

### Testing conventions

Risky logic (the rollback JSON Patch, revision selection, Map graph
construction, the `RolloutInfo` derivation) is kept in **SDK-free modules**
(e.g. `rollbackLogic.ts`, `rolloutGraph.ts`, `rolloutInfo.ts`) so it can be
unit-tested with vitest. Importing `@kinvolk/headlamp-plugin` at test time
crashes (its `ApiProxy` → redux modules touch `localStorage` on import), so keep
new pure logic out of the SDK-coupled modules and add a `*.test.ts` beside it.

## Commit messages & releases

This repo uses [Conventional Commits](https://www.conventionalcommits.org/) and
[release-please](https://github.com/googleapis/release-please). The commit
**type** drives versioning, so it matters:

- `feat:` → minor bump, listed under Features
- `fix:` → patch bump, listed under Bugfixes
- `test:` / `refactor:` / `docs:` / `chore:` / `ci:` → no version bump

Use an optional scope where it helps, e.g. `feat(rollback): ...`. Breaking
changes go in a `feat!:`/`fix!:` subject or a `BREAKING CHANGE:` footer.

## Pull requests

- Branch off `main`; PRs are **squash-merged**, so the PR title becomes the
  Conventional Commit on `main` — title it accordingly.
- Keep PRs focused on one change; link the issue they close (`Closes #NN`).
- release-please opens/updates a `chore(main): release X.Y.Z` PR automatically;
  merging it cuts the tag, GitHub Release, and the attached tarball (+ SHA256).

## Verifying against a live cluster

Front-end and data-path changes are best verified against a real Rollout. A
local [kind](https://kind.sigs.k8s.io/) cluster with Argo Rollouts installed and
a sample canary Rollout is enough to exercise rollback, the progressive-delivery
actions, Set Image, the list columns, and the Map hierarchy. Build/type-check
passing is **not** sufficient for mutating actions — verify them live.
