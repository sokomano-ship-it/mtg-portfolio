const { normalize, sameCardName } = require("./utils");
const { observedAverage } = require("./observations");

const RATIO_RULES = [
  {
    model: "fwb_revised_ratio",
    sourceEdition: "Foreign White Bordered",
    sourceLanguages: ["French", "German", "Italian"],
    referenceEdition: "Revised",
    referenceLanguage: "English"
  },
  {
    model: "legends_italian_ratio",
    sourceEdition: "Legends",
    sourceLanguages: ["Italian"],
    referenceEdition: "Legends",
    referenceLanguage: "English"
  }
];

const MANUAL_CARDS = new Set([
  "jihad",
  "crusade"
]);

function findRatioRule(card) {
  return RATIO_RULES.find(rule =>
    normalize(card.edition) === normalize(rule.sourceEdition) &&
    rule.sourceLanguages.map(normalize).includes(normalize(card.langue))
  );
}

function isManualOnly(card) {
  return MANUAL_CARDS.has(normalize(card.nomCarte || card.nomBase));
}

function findReferenceCard(card, allCards, rule) {
  return allCards.find(candidate =>
    sameCardName(candidate, card) &&
    normalize(candidate.edition) === normalize(rule.referenceEdition) &&
    normalize(candidate.langue) === normalize(rule.referenceLanguage)
  );
}

function applyEditionModel(card, allCards, observations, baseReferencePrice) {
  if (isManualOnly(card)) {
    return {
      editionModel: "manual_observations_only",
      correctedReferencePrice: null,
      editionRatio: null,
      editionConfidence: 0,
      editionObservationCount: 0,
      referenceCardFound: false
    };
  }

  const rule = findRatioRule(card);

  if (!rule) {
    return {
      editionModel: "standard",
      correctedReferencePrice: baseReferencePrice,
      editionRatio: 1,
      editionConfidence: baseReferencePrice ? 80 : 0,
      editionObservationCount: 0,
      referenceCardFound: false
    };
  }

  const referenceCard = findReferenceCard(card, allCards, rule);
  const referencePrice =
    referenceCard
      ? Number(referenceCard.trendPrice || referenceCard.avg30 || referenceCard.avg7 || referenceCard.avg1 || referenceCard.avgPrice || 0)
      : 0;

  if (!referencePrice) {
    return {
      editionModel: rule.model,
      correctedReferencePrice: baseReferencePrice || 0,
      editionRatio: 1,
      editionConfidence: 15,
      editionObservationCount: 0,
      referenceCardFound: Boolean(referenceCard)
    };
  }

  const condition = card.etat || "NM";
  const observed = observedAverage(card, condition, observations);

  if (!observed.value) {
    return {
      editionModel: rule.model,
      correctedReferencePrice: referencePrice,
      editionRatio: 1,
      editionConfidence: 25,
      editionObservationCount: 0,
      referenceCardFound: true
    };
  }

  const ratio = observed.value / referencePrice;

  let confidence = 45 + Math.min(observed.observationCount * 8, 35);
  if (observed.newestAge !== null && observed.newestAge <= 30) confidence += 15;
  else if (observed.newestAge !== null && observed.newestAge <= 90) confidence += 8;

  confidence = Math.min(confidence, 95);

  return {
    editionModel: rule.model,
    correctedReferencePrice: Number((referencePrice * ratio).toFixed(2)),
    editionRatio: Number(ratio.toFixed(4)),
    editionConfidence: confidence,
    editionObservationCount: observed.observationCount,
    referenceCardFound: true
  };
}

module.exports = {
  applyEditionModel,
  isManualOnly,
  findRatioRule
};