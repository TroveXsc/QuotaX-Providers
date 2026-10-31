'use strict';
const fs = require('node:fs'), path = require('node:path');
const P = require('./protocol.cjs');
const safeTag = tag => typeof tag === 'string' && /^[a-zA-Z0-9._+-]{1,180}$/.test(tag) && !tag.startsWith('.');
function metadata(directory, source, now = new Date()) {
  const folder = path.join(directory, 'metadata/manifests'), result = new Map();
  if (!fs.existsSync(folder)) return result;
  const names = fs.readdirSync(folder);
  if (names.length > 10000) throw Error('PUBLICATION_HISTORY_LIMIT');
  for (const name of names) {
    if (!/^[a-f0-9]{64}\.json$/.test(name)) throw Error('PUBLICATION_METADATA_NAME_INVALID');
    const bytes = fs.readFileSync(path.join(folder, name));
    if (P.digest(bytes) + '.json' !== name) throw Error('PUBLICATION_METADATA_DIGEST_INVALID');
    result.set(P.digest(bytes), { bytes, envelope: P.verify(bytes, 'manifest', source, { now, allowExpired: true }) });
  }
  return result;
}
function currentCatalog(directory, source, now = new Date()) {
  const file = path.join(directory, 'channels', source.channel, 'catalog.json');
  if (!fs.existsSync(file)) return null;
  const bytes = fs.readFileSync(file);
  return { bytes, envelope: P.verify(bytes, 'catalog', source, { now, allowExpired: true }) };
}
function validatePlan(plan, load, source, current, history, now = new Date()) {
  if (!plan || Object.keys(plan).sort().join(',') !== 'baseCatalogSHA256,catalogSHA256,channel,id,releaseTags,schemaVersion' ||
      plan.schemaVersion !== 1 || plan.channel !== source.channel || !Array.isArray(plan.releaseTags) || plan.releaseTags.length > 20 ||
      new Set(plan.releaseTags).size !== plan.releaseTags.length || plan.releaseTags.some(t => !safeTag(t))) throw Error('PUBLICATION_PLAN_INVALID');
  const bytes = load('catalog.json'), catalog = P.verify(bytes, 'catalog', source, { now });
  if (P.digest(bytes) !== plan.catalogSHA256 || plan.id !== 'publication-' + P.digest(bytes).slice(0, 24)) throw Error('PUBLICATION_PLAN_BINDING_INVALID');
  const currentDigest = current && P.digest(current.bytes);
  const alreadyCommitted = currentDigest === plan.catalogSHA256;
  if (!alreadyCommitted && (plan.baseCatalogSHA256 !== currentDigest ||
      catalog.signed.publicationSequence !== P.nextSequence(current?.envelope.signed.publicationSequence || 0))) throw Error('PUBLICATION_CATALOG_CONFLICT');
  const releases = [], usedTags = new Set(), versions = new Map(), highest = new Map(), sequenceDigests = new Map();
  for (const { envelope, bytes: previousBytes } of history.values()) {
    const previous = envelope.signed, key = previous.providerId + '@' + previous.releaseVersion;
    const digest = versions.get(key);
    if (digest && digest !== previous.document.sha256) throw Error('PUBLICATION_HISTORY_EQUIVOCATION');
    versions.set(key, previous.document.sha256);
    const sequenceKey = previous.providerId + '#' + previous.publicationSequence;
    if (sequenceDigests.has(sequenceKey) && sequenceDigests.get(sequenceKey) !== P.digest(previousBytes)) throw Error('PUBLICATION_SEQUENCE_EQUIVOCATION');
    sequenceDigests.set(sequenceKey, P.digest(previousBytes));
    const watermark = highest.get(previous.providerId);
    if (watermark && watermark.sequence === previous.publicationSequence && watermark.digest !== P.digest(previousBytes)) throw Error('PUBLICATION_SEQUENCE_EQUIVOCATION');
    if (!watermark || previous.publicationSequence > watermark.sequence) highest.set(previous.providerId, { sequence: previous.publicationSequence, digest: P.digest(previousBytes) });
  }
  for (const entry of catalog.signed.entries) {
    const tag = P.releaseTag(entry.manifestURL), changed = plan.releaseTags.includes(tag);
    const manifestBytes = changed ? load(`artifacts/${tag}/release-manifest.json`) : history.get(entry.manifestSHA256)?.bytes;
    if (!manifestBytes) throw Error('PUBLICATION_MANIFEST_MISSING');
    const manifest = P.verify(manifestBytes, 'manifest', source, { now });
    P.assertEntry(entry, manifest, manifestBytes);
    const signed = manifest.signed, previousDigest = versions.get(signed.providerId + '@' + signed.releaseVersion);
    if (previousDigest && previousDigest !== signed.document.sha256) throw Error('PUBLICATION_VERSION_IMMUTABLE');
    const watermark = highest.get(signed.providerId);
    if (changed && watermark && (signed.publicationSequence < watermark.sequence ||
        signed.publicationSequence === watermark.sequence && P.digest(manifestBytes) !== watermark.digest)) throw Error('PUBLICATION_RELEASE_ROLLBACK');
    const oldEntry = current?.envelope.signed.entries.find(e => e.providerId === signed.providerId);
    if (oldEntry && P.publication.compareVersions(signed.releaseVersion, oldEntry.releaseVersion) < 0) throw Error('PUBLICATION_VERSION_ROLLBACK');
    if (oldEntry) {
      const oldManifest = history.get(oldEntry.manifestSHA256);
      if (!oldManifest) throw Error('PUBLICATION_HISTORY_MISSING');
      const oldSequence = oldManifest.envelope.signed.publicationSequence;
      if (signed.publicationSequence < oldSequence || signed.publicationSequence === oldSequence &&
          entry.manifestSHA256 !== oldEntry.manifestSHA256) throw Error('PUBLICATION_RELEASE_ROLLBACK');
    }
    if (changed) {
      const documentBytes = load(`artifacts/${tag}/provider.json`);
      P.assertDocument(documentBytes, manifest);
      releases.push({ tag, manifestBytes, documentBytes, manifest });
      usedTags.add(tag);
    }
  }
  if (usedTags.size !== plan.releaseTags.length) throw Error('PUBLICATION_UNUSED_ARTIFACT');
  return { plan, catalogBytes: bytes, catalog, releases, alreadyCommitted };
}
module.exports = { safeTag, metadata, currentCatalog, validatePlan };
