const fs = require("fs");
const path = require("path");
const db = require("../database");

const OBS_PATH = path.join(__dirname, "..", "data", "marketObservations.json");
const REFERENCE_CATALOG_PATH = path.join(__dirname, "..", "data", "referenceCatalog.json");
const TRACKED_MARKET_CARDS_PATH = path.join(
  __dirname,
  "..",
  "data",
  "trackedMarketCards.json"
);
const OUTPUT_PATH = path.join(__dirname, "..", "data", "pricingModels.json");

const CONDITIONS = ["PO", "PL", "LP", "GD", "EX", "NM"];

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

function median(values) {
  const cleanValues = values
    .map(Number)
    .filter(value => Number.isFinite(value) && value > 0)
    .sort((a, b) => a - b);

  if (!cleanValues.length) {
    return null;
  }

  const middle = Math.floor(cleanValues.length / 2);

  if (cleanValues.length % 2 === 0) {
    return (
      cleanValues[middle - 1] +
      cleanValues[middle]
    ) / 2;
  }

  return cleanValues[middle];
}

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, Number(value || 0)));
}

/**
 * Construit un indice quotidien à partir des cartes disposant :
 * - d'un Trend actuel ;
 * - d'une moyenne sur 30 jours.
 *
 * Un ratio supérieur à 1 signifie que le marché récent est au-dessus
 * de sa moyenne 30 jours.
 */
function buildSyntheticMarketAnchor(cards) {
  const ratios = cards
    .map(card => {
      const currentPrice = Number(card.trendPrice || 0);
      const baselinePrice = Number(card.avg30 || 0);

      if (currentPrice <= 0 || baselinePrice <= 0) {
        return null;
      }

      const ratio = currentPrice / baselinePrice;

      // Élimine les données probablement anormales.
      if (ratio < 0.50 || ratio > 2) {
        return null;
      }

      return ratio;
    })
    .filter(Boolean);

  const rawFactor = median(ratios);

  if (!rawFactor) {
    return {
      factor: 1,
      rawFactor: 1,
      comparableCount: 0,
      source: "neutral_fallback"
    };
  }

  return {
    factor: Number(clamp(rawFactor, 0.85, 1.15).toFixed(6)),
    rawFactor: Number(rawFactor.toFixed(6)),
    comparableCount: ratios.length,
    source: "portfolio_trend_vs_avg30_median"
  };
}

function readJson(file, fallback) {
  if (!fs.existsSync(file)) return fallback;
  return JSON.parse(fs.readFileSync(file, "utf8"));
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

/**
 * Corrige les prix manuels pour garantir :
 * NM >= EX >= GD >= LP >= PL >= PO
 *
 * Utilise une régression isotone simple :
 * lorsqu'une condition inférieure dépasse la précédente,
 * les deux niveaux sont regroupés à leur moyenne.
 */
function enforceMonotonicManualPrices(byCondition = {}) {
  const orderedConditions = [
    "NM",
    "EX",
    "GD",
    "LP",
    "PL",
    "PO"
  ];

  const blocks = orderedConditions
    .map(condition => {
      const row = byCondition[condition];
      const price = Number(row?.observedPrice || 0);

      if (price <= 0) {
        return null;
      }

      return {
        conditions: [condition],
        totalPrice: price,
        count: 1,
        average: price
      };
    })
    .filter(Boolean);

  let index = 0;

  while (index < blocks.length - 1) {
    const current = blocks[index];
    const next = blocks[index + 1];

    // Violation : une condition moins bonne vaut plus cher.
    if (current.average < next.average) {
      const merged = {
        conditions: [
          ...current.conditions,
          ...next.conditions
        ],
        totalPrice:
          current.totalPrice +
          next.totalPrice,
        count:
          current.count +
          next.count
      };

      merged.average =
        merged.totalPrice / merged.count;

      blocks.splice(index, 2, merged);

      if (index > 0) {
        index -= 1;
      }
    } else {
      index += 1;
    }
  }

  blocks.forEach(block => {
    const correctedPrice =
      Number(block.average.toFixed(2));

    block.conditions.forEach(condition => {
      byCondition[condition] = {
        ...byCondition[condition],

        rawObservedPrice:
          byCondition[condition].observedPrice,

        observedPrice:
          correctedPrice,

        monotonicCorrectionApplied:
          Math.abs(
            Number(
              byCondition[condition].observedPrice
            ) - correctedPrice
          ) > 0.001
      };
    });
  });

  return byCondition;
}

function referenceAnchorPrice(referenceCard) {
  if (!referenceCard) return 0;

  return (
    Number(referenceCard.trendPrice || 0) ||
    Number(referenceCard.avg30 || 0) ||
    Number(referenceCard.avg7 || 0) ||
    Number(referenceCard.avg1 || 0) ||
    0
  );
}
function findTrackedReferenceCard(trackedCards, expectedReference) {
  if (!expectedReference) return null;

  return trackedCards.find(card =>
    normalize(card.nomCarte) === normalize(expectedReference.nomCarte) &&
    normalize(card.edition) === normalize(expectedReference.edition) &&
    normalize(card.langue) === normalize(expectedReference.langue) &&
    (
      !expectedReference.version ||
      normalize(card.version) === normalize(expectedReference.version)
    )
  ) || null;
}

function observationsForCard(card, observations) {
  return observations.filter(obs => cardKey(obs) === cardKey(card));
}

function trainManualModel(
  card,
  observations,
  syntheticMarketAnchor
) {
  const cardObs = observationsForCard(card, observations);
  const byCondition = {};

  CONDITIONS.forEach(condition => {
    const rows = cardObs
      .filter(
        observation =>
          normalize(observation.condition) === normalize(condition)
      )
      .map(observation => ({
        value: observation.observedMinPrice,
        date:
          observation.observationDate ||
          observation.date ||
          observation.createdAt
      }));

    const avg = weightedAverage(rows);

    if (avg) {
      const observationDates = rows
        .map(row => row.date)
        .filter(Boolean)
        .sort();

      byCondition[condition] = {
        observedPrice: Number(avg.toFixed(2)),
        observationCount: rows.length,
        firstObservationDate:
          observationDates[0] || null,
        lastObservationDate:
          observationDates[observationDates.length - 1] || null
      };
    }
  });

  const correctedByCondition =
  enforceMonotonicManualPrices(byCondition);

  return {
    modelType: "manual_only",

    syntheticAnchor: {
      factor: Number(
        syntheticMarketAnchor?.factor || 1
      ),
      rawFactor: Number(
        syntheticMarketAnchor?.rawFactor || 1
      ),
      comparableCount: Number(
        syntheticMarketAnchor?.comparableCount || 0
      ),
      source:
        syntheticMarketAnchor?.source ||
        "neutral_fallback",
      generatedAt: new Date().toISOString()
    },

    byCondition: correctedByCondition
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

function trainEditionRatioModel(
  card,
  observations,
  catalogEntry,
  trackedCards
) {
  const trackedReferenceCard = findTrackedReferenceCard(
    trackedCards,
    catalogEntry.expectedReference
  );

  const effectiveReferenceCard =
    catalogEntry.priceReferenceCard ||
    trackedReferenceCard ||
    null;

  const referenceAnchor =
    referenceAnchorPrice(effectiveReferenceCard);

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
    modelType: "edition_ratio",
    referenceFound: Boolean(effectiveReferenceCard && referenceAnchor > 0),
referenceMarketAnchorPrice: referenceAnchor,
expectedReference: catalogEntry.expectedReference || null,
priceReferenceCard: effectiveReferenceCard,
referenceSource: catalogEntry.priceReferenceCard
  ? "portfolio"
  : trackedReferenceCard
    ? "tracked_market_card"
    : null,
    byCondition
  };
}

function trainGlobalConditionModel(cards, observations) {
  const byCondition = {};

  CONDITIONS.forEach(condition => {
    const ratios = [];

    cards.forEach(card => {
      const anchor = marketAnchorPrice(card);
      if (!anchor) return;

      const obs = observationsForCard(card, observations)
        .filter(o => normalize(o.condition) === normalize(condition))
        .map(o => ({
          value: Number(o.observedMinPrice || 0) / anchor,
          date: o.observationDate || o.date || o.createdAt
        }))
        .filter(x => x.value > 0);

      ratios.push(...obs);
    });

    const avg = weightedAverage(ratios);

    if (avg) {
      byCondition[condition] = {
        ratioToMarketAnchor: Number(avg.toFixed(4)),
        observationCount: ratios.length
      };
    }
  });

  return {
    modelType: "global_condition_market_anchor",
    byCondition
  };
}

async function main() {
  const cards = await getCards();
  const observations = readJson(OBS_PATH, []);
  const referenceCatalog = readJson(REFERENCE_CATALOG_PATH, []);
  const trackedCards = readJson(TRACKED_MARKET_CARDS_PATH, []);
  const syntheticMarketAnchor =
  buildSyntheticMarketAnchor(cards);

console.log(
  "Ancre synthétique :",
  syntheticMarketAnchor.factor,
  `(${syntheticMarketAnchor.comparableCount} comparables)`
);

  const catalogByCardId = new Map(
    referenceCatalog.map(entry => [String(entry.cardId), entry])
  );

  const models = {};

  cards.forEach(card => {
    const key = cardKey(card);
    const anchor = marketAnchorPrice(card);
    const catalogEntry = catalogByCardId.get(String(card.id));

    if (catalogEntry?.model === "manual_only") {
      models[key] = trainManualModel(
  card,
  observations,
  syntheticMarketAnchor
);
      return;
    }

    if (catalogEntry?.model === "edition_ratio") {
      models[key] = trainEditionRatioModel(
  card,
  observations,
  catalogEntry,
  trackedCards
);
      return;
    }

    models[key] = trainStandardModel(card, observations, anchor);
  });
models.__globalConditionModel = trainGlobalConditionModel(cards, observations);
  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(models, null, 2));

  console.log(`Modèles générés : ${OUTPUT_PATH}`);
  console.log(`Cartes modélisées : ${Object.keys(models).length}`);

  db.close();
}

main().catch(error => {
  console.error(error);
  db.close();
});