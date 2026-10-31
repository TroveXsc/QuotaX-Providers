'use strict';
const fs = require('node:fs');
const crypto = require('node:crypto');
const { publication, validators } = require('../generated/publication-sdk.cjs');
const LIMITS = { catalog: 262144, manifest: 262144, document: 4194304 };
const digest = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const serialize = value => Buffer.from(JSON.stringify(value, null, 2) + '\n');
function parse(bytes, kind = 'document') {
  if (bytes.length > LIMITS[kind]) throw Error('PUBLICATION_INPUT_LIMIT');
  return publication.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes),
    kind === 'document' ? {} : { maxCharacters: LIMITS[kind], maxNodes: 20000, maxDepth: 32 });
}
function read(file, kind = 'document') { return parse(fs.readFileSync(file), kind); }
function validate(document) {
  if (!validators.provider(document)) throw Error('PROVIDER_CONTRACT_INVALID:' + JSON.stringify(validators.provider.errors?.slice(0, 3)));
  return document;
}
function inspect(bytes, kind) {
  if (bytes.length > LIMITS[kind]) throw Error('PUBLICATION_INPUT_LIMIT');
  return publication.inspect(new TextDecoder('utf-8', { fatal: true }).decode(bytes), kind, validators);
}
function verify(bytes, kind, source, { now = new Date(), allowExpired = false } = {}) {
  const inspected = inspect(bytes, kind), signed = inspected.envelope.signed;
  const message = Buffer.from(inspected.domain + '\n' + inspected.canonical);
  const published = new Date(signed.publishedAt), expiry = new Date(signed.expiresAt);
  if (!(published < expiry && published <= now && (allowExpired || now < expiry))) throw Error('PUBLICATION_EXPIRED');
  const accepted = inspected.envelope.signatures.some(signature => {
    const key = source.keys.find(k => k.id === signature.keyId && k.algorithm === signature.algorithm && k.usages.includes(kind));
    // Historical signed metadata establishes release identity and replay watermarks.
    // Activation still requires a currently authorized key; an expired retained key
    // can only authenticate its own publication-time history here.
    const keyTime = allowExpired ? published : now;
    if (!key || key.algorithm !== 'Ed25519' || !(new Date(key.notBefore) <= keyTime && keyTime < new Date(key.notAfter))) return false;
    const publicBytes = Buffer.from(key.publicKeyBase64, 'base64');
    const signatureBytes = Buffer.from(signature.signatureBase64, 'base64');
    if (publicBytes.length !== 32 || signatureBytes.length !== 64 || signatureBytes.toString('base64') !== signature.signatureBase64) return false;
    const publicKey = crypto.createPublicKey({ key: Buffer.concat([Buffer.from('302a300506032b6570032100', 'hex'), publicBytes]), format: 'der', type: 'spki' });
    return crypto.verify(null, message, publicKey, signatureBytes);
  });
  if (!accepted) throw Error('PUBLICATION_SIGNATURE_INVALID');
  if (kind === 'catalog' && (signed.sourceId !== source.id || new Set(signed.entries.map(e => e.providerId)).size !== signed.entries.length)) throw Error('PUBLICATION_SOURCE_INVALID');
  return inspected.envelope;
}
function sign(signed, kind, source, privateKey, keyId, now = new Date()) {
  const domain = kind === 'catalog' ? 'QuotaX.ProviderCatalog.v1' : 'QuotaX.ProviderRelease.v1';
  const signature = crypto.sign(null, Buffer.from(domain + '\n' + publication.canonical(signed)), privateKey).toString('base64');
  const bytes = serialize({ schemaVersion: 1, canonicalization: 'RFC8785', signed,
    signatures: [{ algorithm: 'Ed25519', keyId, signatureBase64: signature }] });
  verify(bytes, kind, source, { now });
  return bytes;
}
function sourceFor(configuration, channel) {
  const source = configuration.sources.find(s => s.channel === channel);
  if (!source || !['stable', 'beta'].includes(channel)) throw Error('PUBLICATION_CHANNEL_INVALID');
  return source;
}
function checkedSequence(value) {
  if (!Number.isSafeInteger(value) || value < 1) throw Error('PUBLICATION_SEQUENCE_INVALID');
  return value;
}
function nextSequence(value = 0) { return checkedSequence(value + 1); }
function releaseTag(url) {
  const match = /^https:\/\/github\.com\/TroveXsc\/QuotaX-Providers\/releases\/download\/([a-zA-Z0-9._+-]{1,180})\/release-manifest\.json$/.exec(url);
  if (!match) throw Error('PUBLICATION_MANIFEST_URL_INVALID');
  return match[1];
}
function assertEntry(entry, manifest, manifestBytes) {
  if (entry.providerId !== manifest.signed.providerId || entry.releaseVersion !== manifest.signed.releaseVersion || entry.manifestSHA256 !== digest(manifestBytes)) throw Error('PUBLICATION_ENTRY_MISMATCH');
  const tag = releaseTag(entry.manifestURL);
  if (manifest.signed.document.url !== `https://github.com/TroveXsc/QuotaX-Providers/releases/download/${tag}/provider.json`) throw Error('PUBLICATION_ARTIFACT_URL_INVALID');
  return tag;
}
function assertDocument(bytes, manifest) {
  const claim = manifest.signed, document = validate(parse(bytes));
  const p = document['x-quotax'].provider;
  if (bytes.length !== claim.document.byteLength || digest(bytes) !== claim.document.sha256 ||
      p.id !== claim.providerId || p.releaseVersion !== claim.releaseVersion || p.authContractId !== claim.authContractId ||
      p.minAppVersion !== claim.minAppVersion || claim.assets.length) throw Error('PUBLICATION_DOCUMENT_MISMATCH');
  return document;
}
module.exports = { LIMITS, publication, digest, serialize, parse, read, validate, inspect, verify, sign, sourceFor,
  checkedSequence, nextSequence, releaseTag, assertEntry, assertDocument };
