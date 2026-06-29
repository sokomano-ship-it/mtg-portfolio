const fs = require("fs");
const path = require("path");

const OBS_PATH = path.join(__dirname, "data", "marketObservations.json");

const FWB_EDITION = "Foreign White Bordered";
const REVISED_EDITION = "Revised";
const REVISED_LANGUAGE = "English";
const FWB_LANGUAGES = new Set(["French", "German", "Italian"]);

function normalize(value) {
  return String(value || "").trim().toLowerCase();
}

function isFwbCard(card) {
  return (
    normalize(card.edition) === normalize(FWB_EDITION) &&
    FWB_LANGUAGES.has(String(card.langue || "").trim())
  );
}

function readObservations() {
  if (!fs.existsSync(OBS_PATH)) return [];
  return JSON.parse(fs.readFileSync(OBS_PATH, "utf8"));
}

function sameCardName(a, b) {
  return normalize(a.nomCarte || a.nomBase) === normalize(b.nomCarte || b.nomBase);
}

function isObservationFor(obs, card, condition) {
  return (
    sameCardName(obs, card) &&
    normalize(obs.edition) === normalize(card.edition) &&
    normalize(obs.langue) === normalize(card.langue) &&
    normalize(obs.condition) === normalize(condition)
  );
}

function daysOld(dateText) {
  if (!dateText) return 9999;
  const date = new Date(dateText);
  if (Number.isNaN(date.getTime())) return 9999;
  return Math.max(0, (Date.now() - date.getTime()) / (1000 * 60 * 60 * 24));
}

function recencyWeight(dateText) {
  const d = daysOld(dateText);
  if (d <= 30) return 1.0;
  if (d <= 90) return 0.8;
  if (d <= 180) return 0.6;
  if (d <= 365) return 0.4;
  return 0.2;
}

function latestWeightedAverage(observations) {
  let total = 0;
  let weightTotal = 0;

  observations.forEach(obs => {
    const price = Number(obs.observedMinPrice || 0);
    if (!price) return;

    const weight = recencyWeight(obs.observationDate || obs.date || obs.createdAt);
    total += price * weight;
    weightTotal += weight;
  });

  if (!weightTotal) return null;

  return total / weightTotal;
}

function revisedReferenceCard(card) {
  return {
    nomCarte: card.nomCarte || card.nomBase,
    edition: REVISED_EDITION,
    langue: REVISED_LANGUAGE
  };
}

function computeFwbRatio(card, condition, revisedAutoPrice) {
  if (!isFwbCard(card)) return null;
  if (!revisedAutoPrice || revisedAutoPrice <= 0) return null;

  const observations = readObservations();

  const fwbObs = observations.filter(obs =>
    isObservationFor(obs, card, condition)
  );

  if (!fwbObs.length) {
    return {
      ratio: null,
      observationCount: 0,
      confidence: 0,
      source: "fwb_fallback_revised"
    };
  }

  const fwbPrice = latestWeightedAverage(fwbObs);
  if (!fwbPrice) return null;

  const ratio = fwbPrice / revisedAutoPrice;

  const newestAge = Math.min(
    ...fwbObs.map(obs => daysOld(obs.observationDate || obs.date || obs.createdAt))
  );

  let confidence = 40;
  confidence += Math.min(fwbObs.length * 8, 40);

  if (newestAge <= 30) confidence += 20;
  else if (newestAge <= 90) confidence += 10;
  else if (newestAge <= 180) confidence += 5;

  confidence = Math.min(confidence, 95);

  return {
    ratio: Number(ratio.toFixed(4)),
    observationCount: fwbObs.length,
    fwbObservedPrice: Number(fwbPrice.toFixed(2)),
    confidence,
    source: "fwb_ratio_observed"
  };
}

function estimateFwbPrice(card, condition, revisedAutoPrice) {
  if (!isFwbCard(card)) return null;

  const ratioInfo = computeFwbRatio(card, condition, revisedAutoPrice);

  if (!ratioInfo || !ratioInfo.ratio) {
    return {
      estimatedPrice: Number(revisedAutoPrice || 0),
      ratio: 1,
      observationCount: 0,
      confidence: 20,
      priceSource: "fwb_fallback_revised"
    };
  }

  return {
    estimatedPrice: Number((revisedAutoPrice * ratioInfo.ratio).toFixed(2)),
    ratio: ratioInfo.ratio,
    observationCount: ratioInfo.observationCount,
    confidence: ratioInfo.confidence,
    priceSource: ratioInfo.source,
    fwbObservedPrice: ratioInfo.fwbObservedPrice
  };
}

module.exports = {
  isFwbCard,
  revisedReferenceCard,
  computeFwbRatio,
  estimateFwbPrice
};