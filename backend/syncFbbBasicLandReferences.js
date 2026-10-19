
const fs = require('fs');
const path = require('path');

const trackedPath = path.join(__dirname, 'data', 'trackedMarketCards.json');
const rulesPath = path.join(__dirname, 'data', 'referenceCards.json');

const tracked = JSON.parse(fs.readFileSync(trackedPath, 'utf8'));
const rules = JSON.parse(fs.readFileSync(rulesPath, 'utf8'));

const lands = new Set(['Forest', 'Island', 'Mountain', 'Plains', 'Swamp']);

const relevant = rules.filter(r =>
  lands.has(r.nomCarte) &&
  r.displayEdition === 'Foreign Black Bordered' &&
  r.displayLanguage === 'French' &&
  r.referenceEdition === 'Revised' &&
  r.referenceLanguage === 'English' &&
  /^V\.[123]$/.test(r.displayVersion || '')
);

if (
  relevant.length !== 15 ||
  new Set(relevant.map(r => `${r.nomCarte}|${r.displayVersion}`)).size !== 15
) {
  throw new Error(
    `Expected 15 distinct FBB basic-land rules; got ${relevant.length}. Nothing changed.`
  );
}

const key = c =>
  [c.nomCarte, c.edition, c.langue]
    .map(x => String(x || '').trim().toLowerCase())
    .join('|');

const existing = new Set(tracked.map(key));
const additions = [];

for (const rule of relevant) {
  const ref = {
    nomCarte: `${rule.referenceName || rule.nomCarte} (${rule.displayVersion})`,
    edition: 'Revised',
    langue: 'English'
  };

  if (existing.has(key(ref))) continue;

  const now = new Date().toISOString();

  additions.push({
    id: `reference-fbb-${rule.nomCarte.toLowerCase()}-${rule.displayVersion.toLowerCase().replace('.', '')}`,
    ...ref,
    observable: true,
    referenceFor: 'fbb_basic_land_evolution',
    createdAt: now,
    updatedAt: now
  });

  existing.add(key(ref));
}

console.log(
  'Missing references:',
  additions.map(x => x.nomCarte).join(', ') || '(none)'
);

if (!process.argv.includes('--apply')) {
  console.log('DRY RUN: no changes.');
  process.exit(0);
}

if (additions.length === 0) {
  console.log('Already complete.');
  process.exit(0);
}

const backup = `${trackedPath}.before-fbb-fix.bak`;

if (!fs.existsSync(backup)) {
  fs.copyFileSync(trackedPath, backup, fs.constants.COPYFILE_EXCL);
}

const tmp = `${trackedPath}.fbb.tmp`;

fs.writeFileSync(
  tmp,
  JSON.stringify([...tracked, ...additions], null, 2) + '\n'
);

fs.renameSync(tmp, trackedPath);

console.log(`Added ${additions.length} references. Backup: ${backup}`);
