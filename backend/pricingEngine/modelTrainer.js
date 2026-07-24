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

function getHistoricalMarketPrices() {
  return new Promise((resolve, reject) => {
    db.all(
      `
      SELECT
        cardId,
        date,
        trendPrice,
        avgPrice,
        lowPrice
      FROM card_price_history
      WHERE date IS NOT NULL
      ORDER BY cardId, date, id
      `,
      [],
      (err, rows) => err ? reject(err) : resolve(rows)
    );
  });
}

function normalizeDate(dateValue) {
  if (!dateValue) return null;

  const normalized = String(dateValue).slice(0, 10);

  return /^\d{4}-\d{2}-\d{2}$/.test(normalized)
    ? normalized
    : null;
}

function historicalMarketAnchorPrice(row) {
  if (!row) return 0;

  return (
    Number(row.trendPrice || 0) ||
    Number(row.avgPrice || 0) ||
    Number(row.lowPrice || 0) ||
    0
  );
}

function buildHistoricalAnchorsByCard(rows) {
  const anchorsByCard = new Map();

  rows.forEach(row => {
    const cardId = Number(row.cardId);
    const date = normalizeDate(row.date);
    const anchor = historicalMarketAnchorPrice(row);

    if (!cardId || !date || anchor <= 0) {
      return;
    }

    if (!anchorsByCard.has(cardId)) {
      anchorsByCard.set(cardId, []);
    }

    anchorsByCard.get(cardId).push({
      date,
      anchor
    });
  });

  anchorsByCard.forEach(anchors => {
    anchors.sort((a, b) =>
      String(a.date).localeCompare(String(b.date))
    );
  });

  return anchorsByCard;
}

/**
 * Retourne la dernière ancre connue au plus tard à la date demandée.
 *
 * Une valeur postérieure à l'observation n'est jamais utilisée.
 */
function findHistoricalAnchor(
  historicalAnchorsByCard,
  cardId,
  observationDate
) {
  const normalizedDate = normalizeDate(observationDate);
  const anchors =
    historicalAnchorsByCard.get(Number(cardId)) || [];

  if (!normalizedDate || !anchors.length) {
    return 0;
  }

  for (let index = anchors.length - 1; index >= 0; index -= 1) {
    if (anchors[index].date <= normalizedDate) {
      return Number(anchors[index].anchor || 0);
    }
  }

  return 0;
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


function trainStandardModel(
  card,
  observations,
  currentAnchor,
  historicalAnchorsByCard,
  previousModel = null
) {
  const cardObs = observationsForCard(card, observations);
  const byCondition = {};

  CONDITIONS.forEach(condition => {
    const rows = cardObs
      .filter(
        observation =>
          normalize(observation.condition) === normalize(condition)
      )
      .map(observation => {
        const date =
          observation.observationDate ||
          observation.date ||
          observation.createdAt ||
          null;

        const observedPrice =
          Number(observation.observedMinPrice || 0);

        const historicalAnchor = findHistoricalAnchor(
          historicalAnchorsByCard,
          card.id,
          date
        );

        return {
          observedPrice,
          date,
          historicalAnchor
        };
      })
      .filter(row => row.observedPrice > 0);

    /*
     * Prix observé moyen affiché dans le modèle.
     * Il reste calculé indépendamment du ratio.
     */
    const observedAverage = weightedAverage(
      rows.map(row => ({
        value: row.observedPrice,
        date: row.date
      }))
    );

    /*
     * Chaque observation est divisée par l'ancre qui existait
     * au moment de cette observation.
     */
    const historicalRatios = rows
      .filter(row => row.historicalAnchor > 0)
      .map(row => ({
        value:
          row.observedPrice /
          row.historicalAnchor,

        date: row.date
      }));

    const historicalRatioAverage =
      weightedAverage(historicalRatios);

    /*
     * Lorsque l'historique n'existe pas encore pour une ancienne
     * observation, on conserve le ratio généré lors du précédent
     * entraînement au lieu de le recalculer avec le Trend actuel.
     */
    const previousRatio = Number(
      previousModel?.byCondition?.[condition]
        ?.ratioToMarketAnchor || 0
    );

    const ratioToMarketAnchor =
      historicalRatioAverage ||
      previousRatio ||
      0;

    if (ratioToMarketAnchor > 0) {
      byCondition[condition] = {
        ratioToMarketAnchor: Number(
          ratioToMarketAnchor.toFixed(4)
        ),

        observedPrice: observedAverage
          ? Number(observedAverage.toFixed(2))
          : previousModel?.byCondition?.[condition]
              ?.observedPrice ??
            null,

        observationCount: rows.length,

        historicalRatioCount:
          historicalRatios.length,

        ratioSource:
          historicalRatios.length > 0
            ? "historical_market_anchor"
            : previousRatio > 0
              ? "previous_model_ratio"
              : null
      };
    }
  });

  return {
    modelType: "standard_market_anchor",
    marketAnchorPrice: currentAnchor,
    byCondition
  };
}


function trainEditionRatioModel(
  card,
  observations,
  catalogEntry,
  trackedCards,
  historicalAnchorsByCard,
  previousModel = null
) {
  const trackedReferenceCard = findTrackedReferenceCard(
    trackedCards,
    catalogEntry.expectedReference
  );

  const effectiveReferenceCard =
    catalogEntry.priceReferenceCard ||
    trackedReferenceCard ||
    null;

  const currentReferenceAnchor =
    referenceAnchorPrice(effectiveReferenceCard);

  const referenceCardId =
    Number(effectiveReferenceCard?.id || 0);

  const cardObs = observationsForCard(card, observations);
  const byCondition = {};

  CONDITIONS.forEach(condition => {
    const rows = cardObs
      .filter(
        observation =>
          normalize(observation.condition) === normalize(condition)
      )
      .map(observation => {
        const date =
          observation.observationDate ||
          observation.date ||
          observation.createdAt ||
          null;

        const observedPrice =
          Number(observation.observedMinPrice || 0);

        /*
         * L'historique de la carte de référence ne peut être
         * recherché que lorsque cette référence possède un id
         * correspondant à une carte de la base.
         */
        const historicalReferenceAnchor =
          referenceCardId > 0
            ? findHistoricalAnchor(
                historicalAnchorsByCard,
                referenceCardId,
                date
              )
            : 0;

        return {
          observedPrice,
          date,
          historicalReferenceAnchor
        };
      })
      .filter(row => row.observedPrice > 0);

    const observedAverage = weightedAverage(
      rows.map(row => ({
        value: row.observedPrice,
        date: row.date
      }))
    );

    const historicalRatios = rows
      .filter(
        row =>
          row.historicalReferenceAnchor > 0
      )
      .map(row => ({
        value:
          row.observedPrice /
          row.historicalReferenceAnchor,

        date: row.date
      }));

    const historicalRatioAverage =
      weightedAverage(historicalRatios);

    const previousRatio = Number(
      previousModel?.byCondition?.[condition]
        ?.ratioToReferenceMarketAnchor || 0
    );

    const ratioToReferenceMarketAnchor =
      historicalRatioAverage ||
      previousRatio ||
      0;

    if (ratioToReferenceMarketAnchor > 0) {
      byCondition[condition] = {
        ratioToReferenceMarketAnchor: Number(
          ratioToReferenceMarketAnchor.toFixed(4)
        ),

        observedPrice: observedAverage
          ? Number(observedAverage.toFixed(2))
          : previousModel?.byCondition?.[condition]
              ?.observedPrice ??
            null,

        observationCount: rows.length,

        historicalRatioCount:
          historicalRatios.length,

        ratioSource:
          historicalRatios.length > 0
            ? "historical_reference_anchor"
            : previousRatio > 0
              ? "previous_model_ratio"
              : null
      };
    }
  });

  return {
    modelType: "edition_ratio",

    referenceFound: Boolean(
      effectiveReferenceCard &&
      currentReferenceAnchor > 0
    ),

    referenceMarketAnchorPrice:
      currentReferenceAnchor,

    expectedReference:
      catalogEntry.expectedReference || null,

    priceReferenceCard:
      effectiveReferenceCard,

    referenceSource:
      catalogEntry.priceReferenceCard
        ? "portfolio"
        : trackedReferenceCard
          ? "tracked_market_card"
          : null,

    byCondition
  };
}

function trainGlobalConditionModel(
  cards,
  observations,
  historicalAnchorsByCard,
  previousGlobalModel = null
) {
  const byCondition = {};

  CONDITIONS.forEach(condition => {
    const ratios = [];

    cards.forEach(card => {
      const cardObservations =
        observationsForCard(card, observations)
          .filter(
            observation =>
              normalize(observation.condition) ===
              normalize(condition)
          );

      cardObservations.forEach(observation => {
        const date =
          observation.observationDate ||
          observation.date ||
          observation.createdAt ||
          null;

        const observedPrice =
          Number(observation.observedMinPrice || 0);

        const historicalAnchor =
          findHistoricalAnchor(
            historicalAnchorsByCard,
            card.id,
            date
          );

        if (
          observedPrice <= 0 ||
          historicalAnchor <= 0
        ) {
          return;
        }

        ratios.push({
          value:
            observedPrice /
            historicalAnchor,

          date
        });
      });
    });

    const historicalAverage =
      weightedAverage(ratios);

    const previousRatio = Number(
      previousGlobalModel?.byCondition?.[condition]
        ?.ratioToMarketAnchor || 0
    );

    const ratioToMarketAnchor =
      historicalAverage ||
      previousRatio ||
      0;

    if (ratioToMarketAnchor > 0) {
      byCondition[condition] = {
        ratioToMarketAnchor: Number(
          ratioToMarketAnchor.toFixed(4)
        ),

        observationCount:
          ratios.length ||
          Number(
            previousGlobalModel?.byCondition?.[condition]
              ?.observationCount || 0
          ),

        historicalRatioCount:
          ratios.length,

        ratioSource:
          ratios.length > 0
            ? "historical_market_anchor"
            : previousRatio > 0
              ? "previous_model_ratio"
              : null
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

  const historicalMarketPrices =
    await getHistoricalMarketPrices();

  const historicalAnchorsByCard =
    buildHistoricalAnchorsByCard(
      historicalMarketPrices
    );

  /*
   * Lecture du modèle généré la veille avant de l'écraser.
   * Il sert de secours lorsqu'aucune ancre historique
   * n'est disponible pour une ancienne observation.
   */
  const previousModels =
    readJson(OUTPUT_PATH, {});

  const observations =
    readJson(OBS_PATH, []);

  const referenceCatalog =
    readJson(REFERENCE_CATALOG_PATH, []);

  const trackedCards =
    readJson(TRACKED_MARKET_CARDS_PATH, []);

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
  const catalogEntry =
    catalogByCardId.get(String(card.id));

  const previousModel =
    previousModels[key] || null;

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
      trackedCards,
      historicalAnchorsByCard,
      previousModel
    );

    return;
  }

  models[key] = trainStandardModel(
    card,
    observations,
    anchor,
    historicalAnchorsByCard,
    previousModel
  );
});

models.__globalConditionModel =
  trainGlobalConditionModel(
    cards,
    observations,
    historicalAnchorsByCard,
    previousModels.__globalConditionModel || null
  );

  const historicalRatiosCount = Object.values(models)
  .filter(model => model && model.byCondition)
  .reduce(
    (total, model) =>
      total +
      Object.values(model.byCondition)
        .reduce(
          (subtotal, conditionModel) =>
            subtotal +
            Number(
              conditionModel?.historicalRatioCount || 0
            ),
          0
        ),
    0
  );

const previousRatiosCount = Object.values(models)
  .filter(model => model && model.byCondition)
  .reduce(
    (total, model) =>
      total +
      Object.values(model.byCondition)
        .filter(
          conditionModel =>
            conditionModel?.ratioSource ===
            "previous_model_ratio"
        )
        .length,
    0
  );

console.log(
  `Ratios construits avec historique : ${historicalRatiosCount}`
);

console.log(
  `Ratios conservés depuis le modèle précédent : ${previousRatiosCount}`
);
  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(models, null, 2));

  console.log(`Modèles générés : ${OUTPUT_PATH}`);
  console.log(`Cartes modélisées : ${Object.keys(models).length}`);

  db.close();
}

main().catch(error => {
  console.error(error);
  db.close();
});