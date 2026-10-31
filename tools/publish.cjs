'use strict';
const fs = require('node:fs'), path = require('node:path');
const P = require('./lib/protocol.cjs'), Plan = require('./lib/plan.cjs'), Github = require('./lib/github.cjs');
function publish({ directory, inputCommit, configuration, now = new Date(), publishRelease = Github.publishRelease, push = true }) {
  if (!/^[a-f0-9]{40}$/.test(inputCommit)) throw Error('PUBLICATION_COMMIT_INVALID');
  // A partially written working tree is not publication evidence. Actions retries
  // begin from committed main; local recovery must do the same before reusing a plan.
  if (Github.git(['status', '--porcelain', '--untracked-files=all'], directory)) throw Error('PUBLICATION_WORKTREE_DIRTY');
  const load = relative => {
    if (!/^(plan\.json|catalog\.json|artifacts\/[a-zA-Z0-9._+-]{1,180}\/(provider|release-manifest)\.json)$/.test(relative)) throw Error('PUBLICATION_PATH_INVALID');
    const data = require('node:child_process').execFileSync('git', ['show', `${inputCommit}:inbox/${relative}`], { cwd: directory, maxBuffer: P.LIMITS.document + 1 });
    if (data.length > P.LIMITS.document) throw Error('PUBLICATION_INPUT_LIMIT');
    return data;
  };
  const plan = P.parse(load('plan.json')), source = P.sourceFor(configuration, plan.channel);
  const receiptPath = path.join(directory, 'receipts', plan.id + '.json');
  if (/^publication-[a-f0-9]{24}$/.test(plan.id) && fs.existsSync(receiptPath)) {
    const bytes = load('catalog.json'), catalog = P.verify(bytes, 'catalog', source, { now, allowExpired: true });
    const receipt = P.read(receiptPath);
    if (P.digest(bytes) !== plan.catalogSHA256 || plan.id !== 'publication-' + P.digest(bytes).slice(0, 24) ||
        receipt.id !== plan.id || receipt.catalogSHA256 !== plan.catalogSHA256 || receipt.channel !== plan.channel ||
        receipt.catalogSequence !== catalog.signed.publicationSequence) throw Error('PUBLICATION_RECEIPT_CONFLICT');
    return { ...receipt, reused: true };
  }
  const current = Plan.currentCatalog(directory, source, now), history = Plan.metadata(directory, source, now);
  const checked = Plan.validatePlan(plan, load, source, current, history, now);
  if (checked.alreadyCommitted) {
    if (!fs.existsSync(receiptPath)) throw Error('PUBLICATION_RECEIPT_MISSING');
    const receipt = P.read(receiptPath);
    if (receipt.catalogSHA256 !== plan.catalogSHA256 || receipt.channel !== plan.channel) throw Error('PUBLICATION_RECEIPT_CONFLICT');
    return { ...receipt, reused: true };
  }
  const target = Github.git(['rev-parse', 'HEAD'], directory);
  const releases = [];
  for (const value of checked.releases) releases.push(publishRelease(value, { channel: plan.channel, target }));
  // Only published immutable assets can become discoverable. One Git commit atomically
  // publishes the exact signed catalog, its provenance, and its completion receipt.
  for (const value of checked.releases) {
    const file = path.join(directory, 'metadata/manifests', P.digest(value.manifestBytes) + '.json');
    fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, value.manifestBytes);
  }
  const catalogFile = path.join(directory, 'channels', plan.channel, 'catalog.json');
  fs.mkdirSync(path.dirname(catalogFile), { recursive: true }); fs.writeFileSync(catalogFile, checked.catalogBytes);
  const receipt = { schemaVersion: 1, id: plan.id, channel: plan.channel, catalogSHA256: plan.catalogSHA256,
    catalogSequence: checked.catalog.signed.publicationSequence, publishedAt: now.toISOString(), toolingCommit: target, releases };
  fs.mkdirSync(path.dirname(receiptPath), { recursive: true }); fs.writeFileSync(receiptPath, P.serialize(receipt));
  Github.git(['add', '--', 'channels/' + plan.channel + '/catalog.json', 'metadata/manifests', 'receipts/' + plan.id + '.json'], directory);
  Github.git(['-c', 'user.name=github-actions[bot]', '-c', 'user.email=41898282+github-actions[bot]@users.noreply.github.com',
    'commit', '-m', 'Publish signed Provider catalog ' + plan.channel + ' #' + receipt.catalogSequence], directory);
  if (push) Github.git(['-c', 'credential.helper=', '-c', 'credential.helper=!gh auth git-credential', 'push', 'origin', 'HEAD:main'], directory);
  return receipt;
}
function workflowInput(environment, event) {
  const run = event?.workflow_run;
  if (environment.GITHUB_REPOSITORY !== Github.REPO || environment.GITHUB_EVENT_NAME !== 'workflow_run' ||
      environment.GITHUB_REF !== 'refs/heads/main' || event.repository?.full_name !== Github.REPO ||
      run?.repository?.full_name !== Github.REPO || run?.head_repository?.full_name !== Github.REPO ||
      run.event !== 'push' || run.conclusion !== 'success' || run.name !== 'Provider publication submitted' ||
      !/^publish\/publication-[a-f0-9]{24}$/.test(run.head_branch || '') || !/^[a-f0-9]{40}$/.test(run.head_sha || ''))
    throw Error('PUBLICATION_WORKFLOW_CONTEXT_INVALID');
  return { inputCommit: run.head_sha, branch: run.head_branch };
}
if (require.main === module) {
  try {
    const directory = process.cwd(), configuration = P.read(path.join(__dirname, 'trust.json'));
    const { inputCommit, branch } = workflowInput(process.env, P.read(process.env.GITHUB_EVENT_PATH));
    const planBytes = require('node:child_process').execFileSync('git', ['show', `${inputCommit}:inbox/plan.json`], { cwd: directory, maxBuffer: 262144 });
    if (branch !== 'publish/' + P.parse(planBytes).id) throw Error('PUBLICATION_BRANCH_BINDING_INVALID');
    console.log(JSON.stringify(publish({ directory, inputCommit, configuration })));
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
module.exports = { publish, workflowInput };
