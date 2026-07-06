const fs = require("fs");
const path = require("path");
const db = require("../database");

const MODELS_PATH = path.join(__dirname, "..", "data", "pricingModels.json");
const OUTPUT_PATH = path.join(__dirname, "..", "data", "pricingSimulation.json");
const { estimateCardByGrade } = require("./gradeEstimator");

const FALLBACK_CONDITION_RATIOS = {
  NM: 1.00,
  EX: 0.85,
  GD: 0.70,
  LP: 0.60,
  PL: 0.45,
  PO: 0.30
};

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
      return {
        estimatedPrice: conditionModel.observedPrice,
        pricingModel: "manual_observed",
        marketAnchorPrice: null,
        ratioUsed: null,
        confidence: Math.min(50 + conditionModel.observationCount * 10, 95),
        observationCount: conditionModel.observationCount
      };
    }

    return {
      estimatedPrice: 0,
      pricingModel: "manual_missing_observation",
      marketAnchorPrice: null,
      ratioUsed: null,
      confidence: 0,
      observationCount: 0
    };
  }

  if (
    model.modelType === "fwb_revised" ||
    model.modelType === "legends_italian"
  ) {
    const referenceAnchor = Number(model.referenceMarketAnchorPrice || 0);

    if (conditionModel?.ratioToReferenceMarketAnchor && referenceAnchor) {
      const ratio = conditionModel.ratioToReferenceMarketAnchor;

      return {
        estimatedPrice: Number((referenceAnchor * ratio).toFixed(2)),
        pricingModel: model.modelType,
        marketAnchorPrice: anchor,
        referenceMarketAnchorPrice: referenceAnchor,
        ratioUsed: ratio,
        confidence: Math.min(50 + conditionModel.observationCount * 10, 95),
        observationCount: conditionModel.observationCount,
        referenceCardFound: model.referenceCardFound
      };
    }

    const fallbackRatio =
  globalConditionModel?.byCondition?.[condition]?.ratioToMarketAnchor ??
  FALLBACK_CONDITION_RATIOS[condition] ??
  1;
    const fallbackBase = referenceAnchor || anchor;

    return {
      estimatedPrice: Number((fallbackBase * fallbackRatio).toFixed(2)),
      pricingModel: `${model.modelType}_fallback`,
      marketAnchorPrice: anchor,
      referenceMarketAnchorPrice: referenceAnchor || null,
      ratioUsed: fallbackRatio,
      confidence: referenceAnchor ? 30 : 15,
      observationCount: 0,
      referenceCardFound: model.referenceCardFound
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
async function main() {
  const cards = await getCards();
  const models = readModels();

  const results = cards.map(card => {
    const model = models[cardKey(card)];
    const estimated = estimateCard(
    card,
    model,
    models.__globalConditionModel
);

const gradeEstimate = estimateCardByGrade(card, {
    anchorPrice: estimated.marketAnchorPrice,
    estimatedPrice: estimated.estimatedPrice
});

const estimatedConditionPrice = getEstimatedConditionPrice(
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

    ...estimated,

estimatedPrice: estimatedConditionPrice,
baseEstimatedPrice: estimated.estimatedPrice,

    estimatedByCondition:
        gradeEstimate.estimatedByCondition,

    buyTargetByCondition:
        gradeEstimate.buyTargetByCondition,

    ratioByCondition:
        gradeEstimate.ratioByCondition,

    observationDaysCount:
        gradeEstimate.observationDaysCount,

    observationRowsCount:
        gradeEstimate.observationRowsCount,

    lastObservedMinByCondition:
        gradeEstimate.lastObservedMinByCondition,

    observedMinByCondition:
        gradeEstimate.observedMinByCondition,

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