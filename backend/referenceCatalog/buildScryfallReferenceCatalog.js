const fs = require("fs");
const path = require("path");

const CARDS_PATH = path.join(__dirname, "..", "..", "frontend", "data", "cards.json");
const REFERENCE_CARDS_PATH = path.join(__dirname, "..", "data", "referenceCards.json");
const OUTPUT_PATH = path.join(__dirname, "..", "data", "referenceCatalog.json");
const MISSING_PATH = path.join(__dirname, "..", "data", "missingReferences.json");

function normalize(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function readJson(file, fallback) {
  if (!fs.existsSync(file)) return fallback;
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function getCardsFromSplitFile(raw) {
  if (Array.isArray(raw)) return raw;
  return raw.cards || raw.portfolio || [];
}

function cardName(card) {
  return card.nomCarte || card.nomBase || card.name || "";
}

function same(value1, value2) {
  return normalize(value1) === normalize(value2);
}

function findReferenceRule(card, referenceCards) {
  return referenceCards.find(rule =>
    same(rule.nomCarte, cardName(card)) &&
    same(rule.displayEdition, card.edition) &&
    same(rule.displayLanguage, card.langue)
  ) || null;
}

function findPortfolioCard(portfolio, name, edition, language) {
  return portfolio.find(card =>
    same(cardName(card), name) &&
    same(card.edition, edition) &&
    same(card.langue, language)
  ) || null;
}

function slim(card) {
  if (!card) return null;

  return {
    nomCarte: cardName(card),
    edition: card.edition || null,
    langue: card.langue || null,
    scryfallId: card.scryfallId || card.idScryfall || card.id || null,
    scryfallUri: card.scryfallUri || card.scryfall_uri || null,
    image: card.image || card.imageUrl || card.image_uris?.normal || null,
    trendPrice: Number(card.trendPrice || 0),
    avg1: Number(card.avg1 || 0),
    avg7: Number(card.avg7 || 0),
    avg30: Number(card.avg30 || 0)
  };
}

function buildMissingReferences(catalog) {
  const missingMap = new Map();

  catalog
    .filter(x => !x.referenceFound && x.model !== "manual_only")
    .forEach(x => {
      const key = [
        normalize(x.nomCarte),
        normalize(x.edition),
        normalize(x.langue),
        normalize(x.model)
      ].join("|");

      if (!missingMap.has(key)) {
        missingMap.set(key, {
          nomCarte: x.nomCarte,
          edition: x.edition,
          langue: x.langue,
          model: x.model,
          expectedReference: x.expectedReference || null
        });
      }
    });

  return [...missingMap.values()].sort((a, b) => {
    if (a.edition !== b.edition) return a.edition.localeCompare(b.edition);
    if (a.langue !== b.langue) return a.langue.localeCompare(b.langue);
    return a.nomCarte.localeCompare(b.nomCarte);
  });
}

function main() {
  const rawCards = readJson(CARDS_PATH, {});
  const portfolio = getCardsFromSplitFile(rawCards);
  const referenceCards = readJson(REFERENCE_CARDS_PATH, []);

  const catalog = portfolio.map(card => {
    const rule = findReferenceRule(card, referenceCards);

    let model = "standard";
    let reference = card;
    let expectedReference = null;

    if (rule) {
      model = rule.pricingModel || "standard";

      if (model === "manual_only") {
        reference = null;
      } else {
        expectedReference = {
          nomCarte: rule.referenceName || rule.nomCarte,
          edition: rule.referenceEdition,
          langue: rule.referenceLanguage
        };

        reference = findPortfolioCard(
          portfolio,
          expectedReference.nomCarte,
          expectedReference.edition,
          expectedReference.langue
        );
      }
    }

    const displaySlim = slim(card);

    return {
      cardId: card.id || null,
      nomCarte: cardName(card),
      edition: card.edition,
      langue: card.langue,
      etat: card.etat,
      model,
      displayCard: {
        ...displaySlim,
        image: rule?.imageUrl || displaySlim?.image || null,
        scryfallUri: rule?.scryfallUri || displaySlim?.scryfallUri || null
      },
      priceReferenceCard: slim(reference),
      referenceFound: Boolean(reference),
      expectedReference
    };
  });

  const missing = buildMissingReferences(catalog);

  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(catalog, null, 2));
  fs.writeFileSync(MISSING_PATH, JSON.stringify(missing, null, 2));

  console.log(`Reference catalog généré : ${OUTPUT_PATH}`);
  console.log(`Cartes traitées : ${catalog.length}`);
  console.log(`Références trouvées : ${catalog.filter(x => x.referenceFound).length}`);
  console.log(`Références manquantes lignes : ${catalog.filter(x => !x.referenceFound && x.model !== "manual_only").length}`);
  console.log(`Références manquantes uniques : ${missing.length}`);
  console.log(`Références manquantes exportées : ${MISSING_PATH}`);
}

main();