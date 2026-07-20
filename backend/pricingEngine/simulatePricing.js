const fs = require("fs");
const path = require("path");
const db = require("../database");

const MODELS_PATH = path.join(__dirname, "..", "data", "pricingModels.json");
const OUTPUT_PATH = path.join(__dirname, "..", "data", "pricingSimulation.json");
const { estimateCardByGrade } = require("./gradeEstimator");
const REFERENCE_CATALOG_PATH = path.join(
  __dirname,
  "..",
  "data",
  "referenceCatalog.json"
);

const FALLBACK_CONDITION_RATIOS = {
  NM: 1.00,
  EX: 0.85,
  GD: 0.70,
  LP: 0.60,
  PL: 0.45,
  PO: 0.30
};

const CONDITIONS = ["NM", "EX", "GD", "LP", "PL", "PO"];

function readReferenceCatalog() {
  if (!fs.existsSync(REFERENCE_CATALOG_PATH)) return new Map();

  const rows = JSON.parse(
    fs.readFileSync(REFERENCE_CATALOG_PATH, "utf8")
  );

  return new Map(
    rows.map(row => [Number(row.cardId), row])
  );
}

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

function readModels() {
  if (!fs.existsSync(MODELS_PATH)) return {};
  return JSON.parse(fs.readFileSync(MODELS_PATH, "utf8"));
}

function estimateCard(card, model, globalConditionModel = null) {
  const condition = card.etat || "NM";
  const anchor = marketAnchorPrice(card);

  if (!model) {
    const ratio = FALLBACK_CONDITION_RATIOS[condition] || 1;
    return {
      estimatedPrice: Number((anchor * ratio).toFixed(2)),
      pricingModel: "missing_model_fallback",
      marketAnchorPrice: anchor,
      ratioUsed: ratio,
      confidence: anchor ? 20 : 0
    };
  }

  const conditionModel = model.byCondition?.[condition];

  if (model.modelType === "manual_only") {
  if (conditionModel?.observedPrice) {
  const baseObservedPrice =
    Number(conditionModel.observedPrice || 0);

  const syntheticMarketFactor =
    Number(model.syntheticAnchor?.factor || 1);

  const safeSyntheticMarketFactor =
    syntheticMarketFactor >= 0.85 &&
    syntheticMarketFactor <= 1.15
      ? syntheticMarketFactor
      : 1;

  const estimatedPrice =
    baseObservedPrice * safeSyntheticMarketFactor;

  const comparableCount =
    Number(
      model.syntheticAnchor?.comparableCount || 0
    );

  const baseConfidence = Math.min(
    50 +
      Number(conditionModel.observationCount || 0) * 10,
    90
  );

  const comparableBonus =
    comparableCount >= 100
      ? 5
      : comparableCount >= 30
        ? 3
        : 0;

  return {
    estimatedPrice: Number(
      estimatedPrice.toFixed(2)
    ),

    baseObservedPrice,

    rawObservedPrice:
      Number(
        conditionModel.rawObservedPrice ||
        conditionModel.observedPrice ||
        0
      ),

    pricingModel:
      "manual_synthetic_evolution",

    estimationSource:
      "direct_condition_observation_plus_synthetic_market_anchor",

    marketAnchorPrice: null,

    syntheticMarketFactor:
      safeSyntheticMarketFactor,

    syntheticMarketRawFactor:
      Number(
        model.syntheticAnchor?.rawFactor || 1
      ),

    syntheticComparableCount:
      comparableCount,

    syntheticAnchorSource:
      model.syntheticAnchor?.source ||
      "neutral_fallback",

    ratioUsed:
      safeSyntheticMarketFactor,

    confidence: Math.min(
      baseConfidence + comparableBonus,
      95
    ),

    observationCount:
      Number(
        conditionModel.observationCount || 0
      )
  };
}

  const observedConditions = Object.values(model.byCondition || {})
    .filter(row => Number(row?.observedPrice || 0) > 0);

  const totalObservationCount = observedConditions.reduce(
    (sum, row) => sum + Number(row.observationCount || 0),
    0
  );

  if (observedConditions.length > 0) {
    return {
      estimatedPrice: 0,
      pricingModel: "manual_observed",
      estimationSource: "inferred_from_other_conditions",
      marketAnchorPrice: null,
      ratioUsed: null,
      confidence: Math.min(
        35 + totalObservationCount * 5,
        80
      ),
      observationCount: totalObservationCount
    };
  }

  return {
    estimatedPrice: 0,
    pricingModel: "manual_missing_observation",
    estimationSource: "no_observation",
    marketAnchorPrice: null,
    ratioUsed: null,
    confidence: 0,
    observationCount: 0
  };
}

  if (model.modelType === "edition_ratio") {
    const referenceAnchor = Number(model.referenceMarketAnchorPrice || 0);

    if (conditionModel?.ratioToReferenceMarketAnchor && referenceAnchor) {
        const ratio = conditionModel.ratioToReferenceMarketAnchor;

        return {
            estimatedPrice: Number((referenceAnchor * ratio).toFixed(2)),
            pricingModel: "edition_observed_condition_ratio",
            marketAnchorPrice: anchor,
            referenceMarketAnchorPrice: referenceAnchor,
            ratioUsed: ratio,
            confidence: Math.min(
                50 + conditionModel.observationCount * 10,
                95
            ),
            observationCount: conditionModel.observationCount,
            referenceCardFound: model.referenceFound
        };
    }

    const fallbackRatio =
        globalConditionModel?.byCondition?.[condition]?.ratioToMarketAnchor ??
        FALLBACK_CONDITION_RATIOS[condition] ??
        1;

    const fallbackBase = referenceAnchor || anchor;

    return {
        estimatedPrice: Number((fallbackBase * fallbackRatio).toFixed(2)),
        pricingModel: "edition_fallback_condition_ratio",
        marketAnchorPrice: anchor,
        referenceMarketAnchorPrice: referenceAnchor || null,
        ratioUsed: fallbackRatio,
        confidence: referenceAnchor ? 30 : 15,
        observationCount: 0,
        referenceCardFound: model.referenceFound
    };
}

  if (conditionModel?.ratioToMarketAnchor && anchor) {
    const ratio = conditionModel.ratioToMarketAnchor;

    return {
      estimatedPrice: Number((anchor * ratio).toFixed(2)),
      pricingModel: "standard_observed_condition_ratio",
      marketAnchorPrice: anchor,
      ratioUsed: ratio,
      confidence: Math.min(55 + conditionModel.observationCount * 8, 95),
      observationCount: conditionModel.observationCount
    };
  }

const fallbackRatio =
  globalConditionModel?.byCondition?.[condition]?.ratioToMarketAnchor ??
  FALLBACK_CONDITION_RATIOS[condition] ??
  1;

  return {
    estimatedPrice: Number((anchor * fallbackRatio).toFixed(2)),
    pricingModel: "standard_fallback_condition_ratio",
    marketAnchorPrice: anchor,
    ratioUsed: fallbackRatio,
    confidence: anchor ? 35 : 0,
    observationCount: 0
  };
}

function getEstimatedConditionPrice(card, estimated, gradeEstimate) {
  const condition = String(card.etat || "NM").toUpperCase();

  return Number(
    gradeEstimate?.estimatedByCondition?.[condition] ??
    estimated.estimatedPrice ??
    0
  );
}

function estimateManualConditions(model, estimated) {
  const syntheticFactor = Number(
    estimated.syntheticMarketFactor ||
    model?.syntheticAnchor?.factor ||
    1
  );

  const safeFactor =
    syntheticFactor >= 0.85 && syntheticFactor <= 1.15
      ? syntheticFactor
      : 1;

  const estimatedByCondition = {};

  CONDITIONS.forEach(condition => {
    const observedPrice = Number(
      model?.byCondition?.[condition]?.observedPrice || 0
    );

    estimatedByCondition[condition] =
      observedPrice > 0
        ? Number((observedPrice * safeFactor).toFixed(2))
        : null;
  });

  return {
    estimatedByCondition,

    buyTargetByCondition: {
      NM: estimatedByCondition.NM
        ? Number((estimatedByCondition.NM * 0.90).toFixed(2))
        : null,

      EX: estimatedByCondition.EX
        ? Number((estimatedByCondition.EX * 0.88).toFixed(2))
        : null
    },

    ratioByCondition: null,
    bayesianWeights: null,

    observationDaysCount: null,

    observationRowsCount: CONDITIONS.reduce(
      (total, condition) =>
        total +
        Number(
          model?.byCondition?.[condition]?.observationCount || 0
        ),
      0
    ),

    lastObservedMinByCondition: Object.fromEntries(
      CONDITIONS.map(condition => [
        condition,
        Number(
          model?.byCondition?.[condition]?.rawObservedPrice ||
          model?.byCondition?.[condition]?.observedPrice ||
          0
        ) || null
      ])
    ),

    observedMinByCondition: Object.fromEntries(
      CONDITIONS.map(condition => [
        condition,
        Number(
          model?.byCondition?.[condition]?.observedPrice || 0
        ) || null
      ])
    ),

    reliableObservedByCondition: Object.fromEntries(
      CONDITIONS.map(condition => [
        condition,
        Number(
          model?.byCondition?.[condition]?.observedPrice || 0
        ) || null
      ])
    ),

    observationReliabilityByCondition: Object.fromEntries(
      CONDITIONS.map(condition => [
        condition,
        model?.byCondition?.[condition]?.observedPrice ? 1 : 0
      ])
    ),

    averageObservationReliability: 1,

    confidence: estimated.confidence,

    source:
      "manual observations by condition + synthetic market evolution"
  };
}


async function main() {
  const cards = await getCards();
  const models = readModels();
  const referenceCatalog = readReferenceCatalog();

  const results = cards.map(card => {
    const model = models[cardKey(card)];
    const marketReference =
  referenceCatalog.get(Number(card.id)) || null;
    const estimated = estimateCard(
    card,
    model,
    models.__globalConditionModel
);

const isManualOnly =
  model?.modelType === "manual_only";

let gradeEstimate;

if (isManualOnly) {
  gradeEstimate = estimateManualConditions(
    model,
    estimated
  );
} else {
  const gradeAnchorPrice =
    model?.modelType === "edition_ratio"
      ? estimated.estimatedPrice
      : estimated.marketAnchorPrice;

  gradeEstimate = estimateCardByGrade(card, {
    anchorPrice: gradeAnchorPrice,
    estimatedPrice: estimated.estimatedPrice
  });
}

const estimatedConditionPrice =
  isManualOnly
    ? Number(
        gradeEstimate.estimatedByCondition?.[
          String(card.etat || "NM").toUpperCase()
        ] ||
        estimated.estimatedPrice ||
        0
      )
    : getEstimatedConditionPrice(
        card,
        estimated,
        gradeEstimate
      );

return {

    id: card.id,

    nomCarte: card.nomCarte,

    edition: card.edition,

    langue: card.langue,

    etat: card.etat,

    version: card.version || null,

marketReferenceType:
  marketReference?.marketReferenceType ||
  "same_printing_market",

marketReferenceRole:
  marketReference?.marketReferenceRole ||
  "level_and_evolution",

usesExternalReference:
  Boolean(marketReference?.usesExternalReference),

referenceName:
  marketReference?.referenceName ||
  card.nomCarte,

referenceEdition:
  marketReference?.referenceEdition ||
  card.edition,

referenceLanguage:
  marketReference?.referenceLanguage ||
  card.langue,

referenceVersion:
  marketReference?.referenceVersion ||
  null,

referenceCardFound:
  Boolean(marketReference?.referenceFound),

    ...estimated,

estimatedPrice: estimatedConditionPrice,
baseEstimatedPrice: estimated.estimatedPrice,

    estimatedByCondition:
        gradeEstimate.estimatedByCondition,

    buyTargetByCondition:
        gradeEstimate.buyTargetByCondition,

    ratioByCondition:
        gradeEstimate.ratioByCondition,

    bayesianWeights:
    gradeEstimate.bayesianWeights,

    observationDaysCount:
        gradeEstimate.observationDaysCount,

    observationRowsCount:
        gradeEstimate.observationRowsCount,

    lastObservedMinByCondition:
        gradeEstimate.lastObservedMinByCondition,

    observedMinByCondition:
        gradeEstimate.observedMinByCondition,

    reliableObservedByCondition:
    gradeEstimate.reliableObservedByCondition,

observationReliabilityByCondition:
    gradeEstimate.observationReliabilityByCondition,

averageObservationReliability:
    gradeEstimate.averageObservationReliability,

    gradeModelConfidence:
        gradeEstimate.confidence,

    gradeModelSource:
        gradeEstimate.source

};
  });

  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(results, null, 2));

  const total = results.reduce((sum, row) => sum + Number(row.estimatedPrice || 0), 0);

  console.log(`Simulation générée : ${OUTPUT_PATH}`);
  console.log(`Cartes simulées : ${results.length}`);
  console.log(`Valeur estimée simulée : ${total.toFixed(2)} €`);

  db.close();
}

main().catch(error => {
  console.error(error);
  db.close();
});