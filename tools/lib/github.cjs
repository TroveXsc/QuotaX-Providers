'use strict';
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { spawnSync, execFileSync } = require('node:child_process');
const P = require('./protocol.cjs');
const REPO = 'TroveXsc/QuotaX-Providers';
function gh(args, { notFound = false } = {}) {
  const result = spawnSync('gh', args, { encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    if (notFound && /HTTP 404/.test(result.stderr)) return null;
    throw Error('PUBLICATION_GITHUB_COMMAND_FAILED:' + args.slice(0, 3).join(' '));
  }
  return result.stdout;
}
function release(tag) {
  const result = gh(['api', `repos/${REPO}/releases/tags/${tag}`], { notFound: true });
  return result === null ? null : P.parse(Buffer.from(result));
}
function verifyAssets(tag, artifacts, existing, temporary) {
  for (const [name, bytes] of artifacts) {
    const present = existing.assets.find(a => a.name === name);
    if (!present) continue;
    const folder = path.join(temporary, 'download-' + name); fs.mkdirSync(folder);
    gh(['release', 'download', tag, '--repo', REPO, '--pattern', name, '--dir', folder]);
    if (P.digest(fs.readFileSync(path.join(folder, name))) !== P.digest(bytes)) throw Error('PUBLICATION_RELEASE_ASSET_CONFLICT');
  }
}
function publishRelease(value, { channel, target }) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'quotax-provider-assets-'));
  try {
    const artifacts = [['provider.json', value.documentBytes], ['release-manifest.json', value.manifestBytes]];
    let existing = release(value.tag);
    if (!existing) {
      const args = ['release', 'create', value.tag, '--repo', REPO, '--draft', '--target', target,
        '--title', value.tag, '--notes', 'Generated, signed QuotaX Provider configuration.'];
      if (channel === 'beta') args.push('--prerelease');
      gh(args); existing = release(value.tag);
    }
    if (!existing) throw Error('PUBLICATION_RELEASE_MISSING');
    if (existing.assets.some(a => !artifacts.some(([name]) => name === a.name))) throw Error('PUBLICATION_RELEASE_UNEXPECTED_ASSET');
    verifyAssets(value.tag, artifacts, existing, directory);
    for (const [name, bytes] of artifacts) {
      if (existing.assets.some(a => a.name === name)) continue;
      if (!existing.draft) throw Error('PUBLICATION_RELEASE_INCOMPLETE');
      const file = path.join(directory, name); fs.writeFileSync(file, bytes);
      gh(['release', 'upload', value.tag, file, '--repo', REPO]);
    }
    if (existing.draft) {
      existing = release(value.tag);
      const verifyDirectory = path.join(directory, 'verify'); fs.mkdirSync(verifyDirectory);
      verifyAssets(value.tag, artifacts, existing, verifyDirectory);
      if (existing.assets.length !== artifacts.length) throw Error('PUBLICATION_RELEASE_INCOMPLETE');
      gh(['release', 'edit', value.tag, '--repo', REPO, '--draft=false', '--latest=false']);
    }
    const published = release(value.tag);
    if (!published || published.draft || published.immutable !== true) throw Error('PUBLICATION_RELEASE_NOT_IMMUTABLE');
    return { tag: value.tag, id: published.id, immutable: true };
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
}
function git(args, directory) { return execFileSync('git', args, { cwd: directory, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 }).trim(); }
module.exports = { gh, release, publishRelease, git, REPO };
