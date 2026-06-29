const { observedAverage } = require("./observations");
const { isManualOnly } = require("./editionModel");

function fallbackConditionRatio(condition) {
  const ratios = {
    NM: 1.00,
    EX: 0.85,
    GD: 0.70,
    LP: 0.60,
    PL: 0.45,
    PO: 0.30
  };

  return ratios[condition] || 1.00;
}

function applyConditionModel(card, observations, correctedReferencePrice, editionModelInfo = {}) {
  const condition = card.etat || "NM";
  const observed = observedAverage(card, condition, observations);

  const editionModel = editionModelInfo.editionModel || "standard";
  const hasReliableReference =
    correctedReferencePrice &&
    (
      editionModel === "standard" ||
      editionModelInfo.referenceCardFound ||
      editionModel === "manual_observations_only"
    );

  if (isManualOnly(card)) {
    if (observed.value) {
      return {
        conditionModel: "manual_observed_price",
        conditionRatio: null,
        estimatedPrice: observed.value,
        conditionConfidence: Math.min(50 + observed.observationCount * 10, 95),
        conditionObservationCount: observed.observationCount
      };
    }

    return {
      conditionModel: "manual_missing_observation",
      conditionRatio: null,
      estimatedPrice: 0,
      conditionConfidence: 0,
      conditionObservationCount: 0
    };
  }

  if (observed.value && hasReliableReference) {
    const ratio = observed.value / correctedReferencePrice;

    return {
      conditionModel: "observed_condition_ratio",
      conditionRatio: Number(ratio.toFixed(4)),
      estimatedPrice: observed.value,
      conditionConfidence: Math.min(55 + observed.observationCount * 8, 95),
      conditionObservationCount: observed.observationCount
    };
  }

  const fallback = fallbackConditionRatio(condition);

  return {
    conditionModel: "fallback_condition_ratio",
    conditionRatio: fallback,
    estimatedPrice: Number((Number(correctedReferencePrice || 0) * fallback).toFixed(2)),
    conditionConfidence: correctedReferencePrice ? 35 : 0,
    conditionObservationCount: 0
  };
}

module.exports = {
  applyConditionModel
};