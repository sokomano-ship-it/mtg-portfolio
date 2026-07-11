const fs = require("fs");
const path = require("path");
const axios = require("axios");
const {
  buildIndexes,
  findPriceForCard,
  getProductId
} = require("./pricingEngine/cardmarketLookup");

const TRACKED_PATH = path.join(__dirname, "data", "trackedMarketCards.json");
const PRICE_GUIDE_URL =
  "https://downloads.s3.cardmarket.com/productCatalog/priceGuide/price_guide_1.json";

function readJson(file, fallback) {
  if (!fs.existsSync(file)) return fallback;
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function saveJson(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2), "utf8");
}

function normalize(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function scryfallSetCode(edition) {
  const map = {
    "revised": "3ed",
    "revised edition": "3ed",
    "alliances": "all",
    "foreign black bordered": "fbb",
    "foreign white bordered": "3ed",
    "legends": "leg",
    "arabian nights": "arn",
    "antiquities": "atq"
  };

  return map[normalize(edition)] || null;
}

function scryfallLang(langue) {
  const map = {
    "english": "en",
    "french": "fr",
    "german": "de",
    "italian": "it"
  };

  return map[normalize(langue)] || null;
}

async function searchScryfall(card) {
  const setCode = scryfallSetCode(card.edition);
  const langCode = scryfallLang(card.langue);

  const queries = [];

  if (setCode) {
    queries.push(`!"${card.nomCarte}" set:${setCode}`);
    queries.push(`${card.nomCarte} set:${setCode}`);
  }

  queries.push(`!"${card.nomCarte}"`);
  queries.push(card.nomCarte);

  for (const q of queries) {
    try {
      const response = await axios.get("https://api.scryfall.com/cards/search", {
        params: {
          q,
          unique: "prints",
          include_multilingual: true
        },
        timeout: 20000
      });

      const results = response.data.data || [];
      if (!results.length) continue;

      let match = results[0];

      if (setCode && langCode) {
        match =
          results.find(c => c.set === setCode && c.lang === langCode) ||
          results.find(c => c.set === setCode) ||
          results.find(c => c.lang === langCode) ||
          results[0];
      }

      return match;
    } catch {
      // Try next query
    }
  }

  return null;
}

async function main() {
  const trackedCards = readJson(TRACKED_PATH, []);
  const response = await axios.get(PRICE_GUIDE_URL, {
  timeout: 60000,
  responseType: "json"
});

const priceGuides = response.data.priceGuides || [];
const indexes = buildIndexes(priceGuides);

console.log(`${priceGuides.length} produits Cardmarket chargés.`);

  let resolved = 0;
  let alreadyResolved = 0;
  let skippedManual = 0;
  let missing = 0;

  const enriched = [];

  for (const card of trackedCards) {
    if (card.priceMode === "manual" || card.pricingModel?.includes("fwb")) {
      skippedManual += 1;
      enriched.push(card);
      continue;
    }

    if (card.cardmarketId && card.scryfallId) {
      alreadyResolved += 1;
      enriched.push(card);
      continue;
    }

    const scryfallCard = await searchScryfall(card);

const lookupPrice = findPriceForCard(card, indexes);

const resolvedCardmarketId =
  scryfallCard?.cardmarket_id ||
  getProductId(lookupPrice) ||
  card.cardmarketId ||
  null;

if (!scryfallCard) {
  missing += 1;

  enriched.push({
    ...card,
    cardmarketId: resolvedCardmarketId,
    resolveStatus: resolvedCardmarketId
      ? "resolved_cardmarket_only"
      : "not_found",
    resolvedAt: new Date().toISOString()
  });

  continue;
}

enriched.push({
  ...card,
  cardmarketId: resolvedCardmarketId,
  scryfallId: scryfallCard.id || card.scryfallId || null,
  scryfallUri: scryfallCard.scryfall_uri || card.scryfallUri || null,
  imageUrl:
    scryfallCard.image_uris?.normal ||
    scryfallCard.image_uris?.large ||
    scryfallCard.card_faces?.[0]?.image_uris?.normal ||
    card.imageUrl ||
    null,
  resolvedName: scryfallCard.name || null,
  resolvedSet: scryfallCard.set || null,
  resolvedLang: scryfallCard.lang || null,
  resolveStatus: resolvedCardmarketId
    ? "resolved"
    : "resolved_without_cardmarket",
  resolvedAt: new Date().toISOString()
});

    resolved += 1;

    await new Promise(resolve => setTimeout(resolve, 80));
  }

  saveJson(TRACKED_PATH, enriched);

  console.log(`Cartes suivies déjà résolues : ${alreadyResolved}`);
  console.log(`Cartes suivies résolues : ${resolved}`);
  console.log(`Cartes manuelles ignorées : ${skippedManual}`);
  console.log(`Cartes non trouvées : ${missing}`);
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});