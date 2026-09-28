/**
 * Turns what `tauri-action` built into a release directory.
 *
 * `tauri-action` writes `latest.json` itself only when it also creates the
 * GitHub release, and letting it do that would upload the .dmg before its
 * notarization ticket is stapled on. The release is cut by the workflow after
 * stapling, so the manifest is written here instead.
 */

import {
  appendFileSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { basename, resolve } from "node:path";

const RELEASE_DIR = "release";

const config = JSON.parse(
  readFileSync("apps/tauri/src-tauri/tauri.conf.json", "utf8"),
);
const version = config.version;

const repo = process.env.GITHUB_REPOSITORY;
if (!repo) throw new Error("GITHUB_REPOSITORY is not set");

const artifacts = JSON.parse(process.env.ARTIFACTS ?? "[]");
if (artifacts.length === 0) throw new Error("tauri-action produced no artifacts");

const find = (predicate, what) => {
  const hit = artifacts.find(predicate);
  if (!hit) {
    throw new Error(`no ${what} among:\n${artifacts.join("\n")}`);
  }
  return hit;
};

const dmg = find((path) => path.endsWith(".dmg"), "dmg");
const bundle = find((path) => path.endsWith(".app.tar.gz"), "updater bundle");

/** Tauri writes the signature beside the bundle whether or not it is listed. */
const signature = artifacts.find((path) => path.endsWith(".app.tar.gz.sig"))
  ?? `${bundle}.sig`;
if (!existsSync(signature)) {
  throw new Error(`no updater signature at ${signature}`);
}

mkdirSync(RELEASE_DIR, { recursive: true });
for (const artifact of [dmg, bundle, signature]) {
  copyFileSync(artifact, resolve(RELEASE_DIR, basename(artifact)));
}

const downloadUrl = (path) =>
  `https://github.com/${repo}/releases/download/desktop-v${version}/${basename(path)}`;

/**
 * One universal binary serves both architectures, so both platforms point at
 * the same bundle. The updater matches on the key, not the file.
 */
const platform = {
  signature: readFileSync(signature, "utf8").trim(),
  url: downloadUrl(bundle),
};

writeFileSync(
  resolve(RELEASE_DIR, "latest.json"),
  `${JSON.stringify(
    {
      version,
      notes: `Roster ${version}`,
      pub_date: new Date().toISOString(),
      platforms: {
        "darwin-aarch64": platform,
        "darwin-x86_64": platform,
      },
    },
    null,
    2,
  )}\n`,
);

console.log(`release/ holds ${basename(dmg)}, ${basename(bundle)} and latest.json`);

if (process.env.GITHUB_OUTPUT) {
  appendFileSync(process.env.GITHUB_OUTPUT, `version=${version}\n`);
}
