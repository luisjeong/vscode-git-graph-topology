# Development Environment Modernization Design

## Goal

Modernize the repository's development environment so ongoing work is reproducible on current machines and CI, while avoiding unnecessary extension behavior changes. The immediate success criteria are that a fresh install, compile, and test run work from a lockfile-backed dependency set on a modern Node.js LTS line.

## Current State

The extension is a TypeScript VS Code extension with separate extension-host sources in `src`, webview sources in `web`, and Jest tests in `tests`.

The current toolchain is old:

- TypeScript 4.0.2
- Jest 26 and ts-jest 26
- ESLint 7 with @typescript-eslint 4
- @types/node 8
- @types/vscode 1.38.0
- CI using `actions/checkout@v1`, `actions/setup-node@v1`, and Node 12
- No `package-lock.json`

This makes builds non-reproducible. A fresh install can pull newer transitive type packages that TypeScript 4.0.2 cannot parse. On the current workstation using Node 24.15.0, `npm run compile` reaches `compile-web` and then fails in `node_modules/@types/babel__traverse`.

The full Jest suite also has three failures in `tests/avatarManager.test.ts` caused by URL parsing expectations around a mocked GitHub avatar URL. The GitFlow-specific tests and configuration tests pass.

## Scope

This project updates the development toolchain, CI, dependency reproducibility, and test baseline.

In scope:

- Add and use a lockfile.
- Update CI actions and Node version.
- Update TypeScript, Jest, ts-jest, ESLint, @typescript-eslint, @types/node, @types/vscode, and VSIX packaging tooling.
- Adjust test and lint configuration as needed for the upgraded tools.
- Fix tests that fail because newer Node or newer tools expose outdated assumptions.
- Keep existing compile scripts and source layout unless a small compatibility change is required.

Out of scope:

- Rewriting the extension architecture.
- Migrating the webview bundling pipeline to a new bundler.
- Changing Git Graph user-facing behavior beyond fixes needed to preserve existing behavior under the upgraded toolchain.
- Adopting a fully latest VS Code API baseline unless required by the chosen supported runtime.

## Compatibility Policy

Use a realistic support baseline rather than a full latest-only rewrite.

The repository should declare a modern Node.js development baseline and use the same baseline in CI. Prefer an active LTS release for CI and document the expected local Node range through `package.json` engines or a lightweight version file if the project conventions support it.

The VS Code extension runtime baseline should be raised only as much as needed to keep `engines.vscode`, `@types/vscode`, and expected development tooling coherent. If the minimum VS Code version changes, the change must be explicit in `package.json` and noted in user-facing release documentation.

## Dependency Strategy

Introduce `package-lock.json` and switch CI from `npm install` to `npm ci`. This prevents transitive dependency drift and makes build failures reproducible.

Upgrade the TypeScript and test stack as a coordinated set:

- TypeScript should be new enough to parse current transitive type declarations.
- Jest and ts-jest should be upgraded together to a supported pairing.
- ESLint and @typescript-eslint should be upgraded together to a supported pairing.
- Node and VS Code type packages should match the intended runtime and extension API baseline.
- `vsce` should be replaced with or upgraded to the maintained packaging tool if needed.

Dependency updates should be committed with the lockfile so CI and local installs use the same resolved graph.

## Configuration Changes

Expected configuration updates:

- Update `.github/workflows/build-and-test.yml` to current GitHub Actions versions.
- Use `npm ci` in CI.
- Update Jest configuration if the upgraded `ts-jest` no longer accepts the old `globals` configuration shape.
- Update ESLint configuration only where required by the newer parser and plugin versions.
- Keep `src/tsconfig.json`, `web/tsconfig.json`, and `tests/tsconfig.json` structurally similar unless newer TypeScript requires explicit compatibility settings.

## Test Repair Policy

Failing tests should be treated as compatibility signals, not ignored.

For the known avatar failures, investigate the actual URL handling path before changing assertions. The intended behavior is to download the avatar URL returned by the GitHub API with the desired size parameter and to preserve the existing fallback behavior. The fix may be in production code, tests, or both, depending on which side encodes the older assumption.

No broad test rewrites should be bundled into this work. Each test change should correspond to a toolchain compatibility issue or a preserved behavior assertion.

## Verification

The completed work must pass:

```powershell
npm ci
npm run compile
npm test -- --runInBand
```

The final report should include the Node version used locally, the CI Node version selected, and any known residual compatibility notes.

## Risks

Upgrading `@types/vscode` without adjusting `engines.vscode` can create a false sense that newer APIs are safe to use. Keep those two values aligned.

Upgrading TypeScript may surface stricter diagnostics in old code. Prefer targeted fixes that preserve behavior over large refactors.

Upgrading Jest and ts-jest may require configuration changes that alter test transpilation. Keep test runtime behavior close to the existing setup and verify the whole suite.

Node 24 is newer than the current LTS baseline for many projects. It is useful as a stress test, but CI should use the chosen supported LTS version unless the project explicitly commits to Node 24.

## Acceptance Criteria

- A clean clone can install with `npm ci`.
- CI uses current GitHub Actions and lockfile-backed installs.
- `npm run compile` succeeds.
- `npm test -- --runInBand` succeeds.
- The repository documents or declares the expected Node development baseline.
- Any VS Code minimum version change is intentional and visible.
