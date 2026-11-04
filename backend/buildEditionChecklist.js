/* Independent, read-only edition checklist generator. Node 24+. */
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const input = path.join(root, 'frontend/data/cards.json');
const output = path.join(root, 'frontend/data/edition-checklist.json');
const overridesPath = path.join(root, 'backend/edition-checklist-overrides.json');
const wait = ms => new Promise(r => setTimeout(r, ms));
const norm = s => String(s ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase();
const baseName = s => String(s ?? '').replace(/\s*\(V\.\d+\)\s*$/i, '').trim();
const editionAliases = {
  'Arabian Nights': 'arn', 'Antiquities': 'atq', 'Legends': 'leg',
  'The Dark': 'drk', 'Fallen Empires': 'fem', 'Homelands': 'hml',
  'Revised': '3ed', 'Unlimited': '2ed', 'Limited Edition Alpha': 'lea',
  'Limited Edition Beta': 'leb', 'Fourth Edition': '4ed', 'Ice Age': 'ice',
  'Alliances': 'all', 'Mirage': 'mir', 'Visions': 'vis', 'Weatherlight': 'wth',
'Foreign Black Bordered': 'fbb', 'Foreign White Bordered': '3ed',
'Sixth Edition': '6ed',
'Legends Italian': 'leg'
};
async function getJson(url) {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(url, { headers: { 'User-Agent': 'MTGPortfolioChecklist/1.0', Accept: 'application/json' }, signal: AbortSignal.timeout(25000) });
      if (res.status === 429 || res.status >= 500) { await wait(1000 * (attempt + 1)); continue; }
      if (!res.ok) throw new Error(`${res.status} ${url}`);
      return res.json();
    } catch (err) { if (attempt === 2) throw err; await wait(1000 * (attempt + 1)); }
  }
  throw new Error('Scryfall unavailable');
}
async function fetchSet(code) {
let url = `https://api.scryfall.com/cards/search?q=${encodeURIComponent('e:' + code)}&unique=prints&include_variations=true&order=set`;
  const cards = [];
  while (url) {
    const page = await getJson(url);
    cards.push(...(page.data || []));
    url = page.has_more ? page.next_page : null;
    await wait(500);
  }
  return cards;
}
function loadOverrides() {
  if (!fs.existsSync(overridesPath)) return { editionCodes: {}, variants: [], matches: {}, versionMatches: {} };
  const data = JSON.parse(fs.readFileSync(overridesPath, 'utf8'));
  return { editionCodes: data.editionCodes || {}, variants: data.variants || [], matches: data.matches || {}, versionMatches: data.versionMatches || {} };
}
async function main() {
const cardsData = JSON.parse(fs.readFileSync(input, 'utf8'));
const cards = Array.isArray(cardsData) ? cardsData : cardsData.cards;

if (!Array.isArray(cards)) {
  throw new Error('cards.json: propriété cards absente ou invalide');
}
  const overrides = loadOverrides();
  const editions = [...new Set(cards.map(c => String(c.edition || '').trim()).filter(Boolean))].sort();
  const sets = (await getJson('https://api.scryfall.com/sets')).data || [];
  const setByName = new Map(sets.map(s => [norm(s.name), s.code]));
  const result = { generatedAt: new Date().toISOString(), editions: [], warnings: [] };
  const cache = new Map();
  for (const edition of editions) {
const code = edition === 'Foreign White Bordered'
  ? '3ed'
  : (overrides.editionCodes[edition] || editionAliases[edition] || setByName.get(norm(edition)));
    if (!code) { result.warnings.push(`Édition non reconnue : ${edition}`); continue; }
    try {
      if (!cache.has(code)) cache.set(code, await fetchSet(code));
      const prints = cache.get(code);
      const entries = prints
  .filter(p => !(edition === 'Foreign Black Bordered' && p.collector_number === '306a'))
  .map(p => ({
        key: `${edition}|${p.id}`, scryfallId: p.id, name: p.name,
        collectorNumber: p.collector_number, imageUrl: p.image_uris?.normal || p.card_faces?.[0]?.image_uris?.normal || null,
        variant: '', reserved: p.reserved === true, owned: 0, conditions: {}, matchStatus: 'catalogue'
      }));
      for (const extra of overrides.variants.filter(v => v.edition === edition)) {
        entries.push({ key: `${edition}|custom:${extra.id}`, scryfallId: extra.scryfallId || null, name: extra.name,
          collectorNumber: extra.collectorNumber || '', imageUrl: extra.imageUrl || null,
          variant: extra.variant || '',
          reserved: (() => {
            const match = prints.find(p => extra.scryfallId && p.id === extra.scryfallId)
              || prints.find(p => norm(p.name) === norm(extra.name));
            return match ? match.reserved === true : null;
          })(),
          owned: 0, conditions: {}, matchStatus: 'catalogue' });
      }
      const unresolved = [];
      for (const card of cards.filter(c => c.edition === edition)) {
        const ownedKey = String(card.id ?? `${card.nomCarte}|${card.langue}|${card.version}`);
        const explicit = overrides.matches[ownedKey];
        const cardName = baseName(card.nomBase || card.nomCarte);
        const name = norm(cardName);
        const version = String(
          card.version || card.nomCarte?.match(/\(V\.\d+\)/i)?.[0] || ''
        ).replace(/[()]/g, '').trim().toUpperCase();
        const versionKey = `${edition}|${cardName}|${version}`;
        const collectorNumber = overrides.versionMatches[versionKey];
        let candidates;
        if (explicit) {
          // Existing per-record override has priority.
          candidates = entries.filter(e => e.key === explicit);
        } else if (/^V\.\d+$/i.test(version)) {
          // Never guess a Cardmarket variant from Scryfall order or shared IDs.
          candidates = collectorNumber == null ? [] : entries.filter(e =>
            norm(baseName(e.name)) === name &&
            String(e.collectorNumber) === String(collectorNumber)
          );
          if (collectorNumber != null && candidates.length !== 1) {
            throw new Error(`Correspondance invalide ${versionKey} -> ${collectorNumber} (${candidates.length} candidats)`);
          }
        } else {
          candidates = entries.filter(e =>
            e.scryfallId && card.scryfallId && e.scryfallId === card.scryfallId
          );
          if (!candidates.length) {
            candidates = entries.filter(e => norm(baseName(e.name)) === name);
          }
        }
        if (candidates.length !== 1) {
          unresolved.push({ id: card.id, name: card.nomCarte, version: card.version || '', language: card.langue || '', reason: candidates.length ? 'Correspondance ambiguë' : 'Aucune correspondance fiable' });
          continue;
        }
        const entry = candidates[0];
        // Use the already validated image from Ma collection for owned FBB/FWB cards.
        if (
  (edition === 'Foreign Black Bordered' || edition === 'Foreign White Bordered') &&
  card.imageUrl &&
  !/^V\.\d+$/i.test(version)
) {
  entry.imageUrl = card.imageUrl;
}
        const qty = Math.max(1, Number(card.quantity) || 1);
        const condition = String(card.etat || 'INCONNU').toUpperCase();
        entry.owned += qty;
        entry.conditions[condition] = (entry.conditions[condition] || 0) + qty;
        entry.matchStatus = 'possédée';
      }
      result.editions.push({ name: edition, code, cards: entries, unresolved });
      console.log(`${edition}: ${entries.length} impressions, ${unresolved.length} associations à vérifier`);
    } catch (err) {
  console.error(`ERREUR ÉDITION ${edition}:`, err);
  result.warnings.push(`${edition}: ${err.message}`);
}
  }
  if (result.editions.length !== editions.length) {
  throw new Error(
    `Catalogue incomplet : ${result.editions.length}/${editions.length} éditions. ` +
    `Le fichier existant est conservé.`
  );
}
  fs.mkdirSync(path.dirname(output), { recursive: true });
  const tmp = `${output}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(result, null, 2));
  fs.renameSync(tmp, output);
  console.log(`Wrote ${output}`);
  if (result.warnings.length) console.warn(result.warnings.join('\n'));
}
main().catch(e => { console.error(e); process.exitCode = 1; });
