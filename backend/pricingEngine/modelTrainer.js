const fs = require("fs");
const path = require("path");
const db = require("../database");

const OBS_PATH = path.join(__dirname, "..", "data", "marketObservations.json");
const OUTPUT_PATH = path.join(__dirname, "..", "data", "pricingModels.json");

const CONDITIONS = ["PO", "PL", "LP", "GD", "EX", "NM"];
const { findReferenceMarketCard } = require("../referenceCatalog/referenceLookup");
const EDITION_REFERENCE_RULES = [
  {
    model: "fwb_revised",
    sourceEdition: "Foreign White Bordered",
    sourceLanguages: ["French", "German", "Italian"],
    referenceEdition: "Revised",
    referenceLanguage: "English"
  },
  {
    model: "legends_italian",
    sourceEdition: "Legends",
    sourceLanguages: ["Italian"],
    referenceEdition: "Legends",
    referenceLanguage: "English"
  }
];

const MANUAL_ONLY = new Set(["jihad", "crusade"]);

function normalize(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function cardKey(card) {
  return [
    normalize(card.nomCarte || card.nomBase),
    normalize(card.edition),
    normalize(card.langue)
  ].join("|");
}

function cardNameKey(card) {
  return normalize(card.nomCarte || card.nomBase);
}

function daysOld(dateText) {
  if (!dateText) return 9999;
  const d = new Date(dateText);
  if (Number.isNaN(d.getTime())) return 9999;
  return Math.max(0, (Date.now() - d.getTime()) / (1000 * 60 * 60 * 24));
}

function weight(dateText) {
  const d = daysOld(dateText);
  if (d <= 30) return 1.0;
  if (d <= 90) return 0.8;
  if (d <= 180) return 0.6;
  if (d <= 365) return 0.4;
  return 0.2;
}

function weightedAverage(values) {
  let total = 0;
  let weights = 0;

  values.forEach(v => {
    const value = Number(v.value || 0);
    if (!value) return;

    const w = weight(v.date);
    total += value * w;
    weights += w;
  });

  return weights ? total / weights : null;
}

function getCards() {
  return new Promise((resolve, reject) => {
    db.all(
      `
      SELECT
        c.*,
        cp.trendPrice,
        cp.avgPrice,
        cp.lowPrice,
        cp.avg1,
        cp.avg7,
        cp.avg30
      FROM cards c
      LEFT JOIN cardmarket_prices cp
        ON cp.id = (
          SELECT MAX(id)
          FROM cardmarket_prices
          WHERE cardId = c.id
        )
      ORDER BY c.id
      `,
      [],
      (err, rows) => err ? reject(err) : resolve(rows)
    );
  });
}

function marketAnchorPrice(card) {
  return (
    Number(card.trendPrice || 0) ||
    Number(card.avg30 || 0) ||
    Number(card.avg7 || 0) ||
    Number(card.avg1 || 0) ||
    Number(card.avgPrice || 0) ||
    Number(card.lowPrice || 0) ||
    0
  );
}

function readObservations() {
  if (!fs.existsSync(OBS_PATH)) return [];
  return JSON.parse(fs.readFileSync(OBS_PATH, "utf8"));
}

function findEditionRule(card) {
  return EDITION_REFERENCE_RULES.find(rule =>
    normalize(card.edition) === normalize(rule.sourceEdition) &&
    rule.sourceLanguages.map(normalize).includes(normalize(card.langue))
  );
}

function findReferenceCard(card, cards, rule) {
  return cards.find(ref =>
    cardNameKey(ref) === cardNameKey(card) &&
    normalize(ref.edition) === normalize(rule.referenceEdition) &&
    normalize(ref.langue) === normalize(rule.referenceLanguage)
  );
}

function observationsForCard(card, observations) {
  return observations.filter(obs => cardKey(obs) === cardKey(card));
}

function trainManualModel(card, observations) {
  const cardObs = observationsForCard(card, observations);
  const byCondition = {};

  CONDITIONS.forEach(condition => {
    const rows = cardObs
      .filter(o => normalize(o.condition) === normalize(condition))
      .map(o => ({
        value: o.observedMinPrice,
        date: o.observationDate || o.date || o.createdAt
      }));

    const avg = weightedAverage(rows);

    if (avg) {
      byCondition[condition] = {
        observedPrice: Number(avg.toFixed(2)),
        observationCount: rows.length
      };
    }
  });

  return {
    modelType: "manual_only",
    byCondition
  };
}

function trainStandardModel(card, observations, anchor) {
  const cardObs = observationsForCard(card, observations);
  const byCondition = {};

  CONDITIONS.forEach(condition => {
    const rows = cardObs
      .filter(o => normalize(o.condition) === normalize(condition))
      .map(o => ({
        value: o.observedMinPrice,
        date: o.observationDate || o.date || o.createdAt
      }));

    const avg = weightedAverage(rows);

    if (avg && anchor) {
      byCondition[condition] = {
        ratioToMarketAnchor: Number((avg / anchor).toFixed(4)),
        observedPrice: Number(avg.toFixed(2)),
        observationCount: rows.length
      };
    }
  });

  return {
    modelType: "standard_market_anchor",
    marketAnchorPrice: anchor,
    byCondition
  };
}

function trainEditionRatioModel(card, cards, observations, rule) {
  const referenceCard = findReferenceMarketCard({
  nomCarte: card.nomCarte || card.nomBase,
  nomBase: card.nomBase,
  edition: rule.referenceEdition
});

const referenceAnchor = referenceCard ? Number(referenceCard.marketAnchorPrice || 0) : 0;

  const cardObs = observationsForCard(card, observations);
  const byCondition = {};

  CONDITIONS.forEach(condition => {
    const rows = cardObs
      .filter(o => normalize(o.condition) === normalize(condition))
      .map(o => ({
        value: o.observedMinPrice,
        date: o.observationDate || o.date || o.createdAt
      }));

    const avg = weightedAverage(rows);

    if (avg && referenceAnchor) {
      byCondition[condition] = {
        ratioToReferenceMarketAnchor: Number((avg / referenceAnchor).toFixed(4)),
        observedPrice: Number(avg.toFixed(2)),
        observationCount: rows.length
      };
    }
  });

  return {
    modelType: rule.model,
    referenceEdition: rule.referenceEdition,
    referenceLanguage: rule.referenceLanguage,
    referenceCardFound: Boolean(referenceCard),
referenceMarketAnchorPrice: referenceAnchor,
referenceCardmarketId: referenceCard ? referenceCard.cardmarketId : null,
referenceName: referenceCard ? referenceCard.name : null,
referenceEditionMatched: referenceCard ? referenceCard.edition : null,
    byCondition
  };
}

async function main() {
  const cards = await getCards();
  const observations = readObservations();

  const models = {};

  cards.forEach(card => {
    const key = cardKey(card);
    const anchor = marketAnchorPrice(card);
    const editionRule = findEditionRule(card);

    if (MANUAL_ONLY.has(cardNameKey(card))) {
      models[key] = trainManualModel(card, observations);
      return;
    }

    if (editionRule) {
      models[key] = trainEditionRatioModel(card, cards, observations, editionRule);
      return;
    }

    models[key] = trainStandardModel(card, observations, anchor);
  });

  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(models, null, 2));

  console.log(`Modèles générés : ${OUTPUT_PATH}`);
  console.log(`Cartes modélisées : ${Object.keys(models).length}`);

  db.close();
}

main().catch(error => {
  console.error(error);
  db.close();
});