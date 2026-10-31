'use strict';
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { spawnSync, execFileSync } = require('node:child_process');
const P = require('./protocol.cjs');
const REPO = 'TroveXsc/QuotaX-Providers';
function gh(args, { notFound = false, input } = {}) {
  const result = spawnSync('gh', args, { encoding: 'utf8', maxBuffer: 8 * 1024 * 1024, input });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    if (notFound && /HTTP 404/.test(result.stderr)) return null;
    throw Error('PUBLICATION_GITHUB_COMMAND_FAILED:' + args.slice(0, 3).join(' '));
  }
  return result.stdout;
}
function release(tag) {
  const result = gh(['api', `repos/${REPO}/releases/tags/${tag}`], { notFound: true });
  if (result !== null) return checkedRelease(P.parse(Buffer.from(result)), tag);
  // REST's tag endpoint only finds published releases. A draft's tag does not
  // exist yet: resolve its pending tag through GraphQL, then pin the numeric ID.
  // This is the same distinction used by GitHub CLI's FetchRelease adapter.
  // https://github.com/cli/cli/blob/v2.102.0/pkg/cmd/release/shared/fetch.go
  const query = 'query($tag: String!) { repository(owner: "TroveXsc", name: "QuotaX-Providers") { release(tagName: $tag) { databaseId isDraft } } }';
  const response = P.parse(Buffer.from(gh(['api', 'graphql', '-f', 'query=' + query, '-f', 'tag=' + tag])));
  const pending = response.data?.repository?.release;
  if (!pending) return null;
  return releaseByID(pending.databaseId, tag);
}
function checkedRelease(value, tag) {
  if (!Number.isSafeInteger(value?.id) || value.id <= 0 || value.tag_name !== tag ||
      typeof value.draft !== 'boolean' || !Array.isArray(value.assets)) throw Error('PUBLICATION_RELEASE_IDENTITY_INVALID');
  return value;
}
function releaseByID(id, tag) {
  if (!Number.isSafeInteger(id) || id <= 0) throw Error('PUBLICATION_RELEASE_IDENTITY_INVALID');
  const value = checkedRelease(P.parse(Buffer.from(gh(['api', `repos/${REPO}/releases/${id}`]))), tag);
  if (value.id !== id) throw Error('PUBLICATION_RELEASE_IDENTITY_INVALID');
  return value;
}
function createDraft(tag, { channel, target }) {
  const body = JSON.stringify({ tag_name: tag, target_commitish: target, name: tag,
    body: 'Generated, signed QuotaX Provider configuration.', draft: true, prerelease: channel === 'beta', make_latest: 'false' });
  const value = checkedRelease(P.parse(Buffer.from(gh(['api', '--method', 'POST', `repos/${REPO}/releases`, '--input', '-'], { input: body }))), tag);
  if (!value.draft) throw Error('PUBLICATION_RELEASE_NOT_DRAFT');
  return value;
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
    if (!existing) existing = createDraft(value.tag, { channel, target });
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
      existing = releaseByID(existing.id, value.tag);
      const verifyDirectory = path.join(directory, 'verify'); fs.mkdirSync(verifyDirectory);
      verifyAssets(value.tag, artifacts, existing, verifyDirectory);
      if (existing.assets.length !== artifacts.length) throw Error('PUBLICATION_RELEASE_INCOMPLETE');
      gh(['release', 'edit', value.tag, '--repo', REPO, '--draft=false', '--latest=false']);
    }
    const published = releaseByID(existing.id, value.tag);
    if (!published || published.draft || published.immutable !== true) throw Error('PUBLICATION_RELEASE_NOT_IMMUTABLE');
    return { tag: value.tag, id: published.id, immutable: true };
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
}
function git(args, directory) { return execFileSync('git', args, { cwd: directory, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 }).trim(); }
module.exports = { gh, release, releaseByID, publishRelease, git, REPO };
