# Releasing

Two things here ship on their own schedule: the Mac app and the `roster` CLI.
The web app is not one of them — deploying it is
[its own document](deploying.md).

## The Mac app

The build runs here and publishes a release on this repository against the
pushed tag — `.dmg` for people, `.app.tar.gz` plus `latest.json` for the
updater, which installed copies check once at launch.

```bash
# bump "version" in apps/tauri/src-tauri/tauri.conf.json, then
git tag desktop-v0.1.0 && git push origin desktop-v0.1.0
```

The tag has to match that version or the workflow stops — a disagreement ships
an update nobody is offered. The updater reads
`releases/latest/download/latest.json` on this repository, and GitHub's
`latest` means the newest release of any kind — so desktop releases have to
stay the only GitHub releases cut here, or every release has to carry a
`latest.json`.

> Releases up to 0.1.4 live in
> [`roster-releases`](https://github.com/harshithmullapudi/roster-releases),
> which existed because this repository used to be private. Installs that old
> still poll it, so its final release is a `latest.json` whose URLs point at
> this repository's assets — enough to carry them across once, after which
> they follow the endpoint baked into the newer build.

Secrets on this repository, all but the last one shared with `core`:

| Secret | What it is |
| --- | --- |
| `APPLE_CERTIFICATE`, `APPLE_CERTIFICATE_PASSWORD` | Developer ID cert as base64 `.p12`, and its password |
| `APPLE_SIGNING_IDENTITY` | e.g. `Developer ID Application: … (TEAMID)` |
| `APPLE_ID`, `APPLE_ID_PASSWORD`, `TEAM_ID` | Notarization — the password is an app-specific one |
| `TAURI_SIGNING_PRIVATE_KEY`, `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | Updater signing key. **Not** `core`'s: the public half is baked into `tauri.conf.json`, and losing the private half means no installed copy can ever update again |

## The CLI

`packages/cli` is the one package in this repo that ships to the public
registry. It has no runtime dependencies and compiles to plain `dist/`, so a
release is a version bump and one command:

```bash
# bump "version" in packages/cli/package.json, then
npm login              # once per machine
pnpm release:cli       # builds, tests, publishes --access public
```

The default host agents talk to lives in `packages/cli/src/config.ts`, so moving
the deployment means cutting a new CLI version too. Anyone pointing at their own
Roster passes `roster login --api-url https://…` instead.
