const fs = require("fs");
const path = require("path");
const { normalize, sameCardName, weightedAverage, daysOld } = require("./utils");

const OBS_PATH = path.join(__dirname, "..", "data", "marketObservations.json");

function readObservations() {
  if (!fs.existsSync(OBS_PATH)) return [];
  return JSON.parse(fs.readFileSync(OBS_PATH, "utf8"));
}

function observationsForCard(card, observations) {
  return observations.filter(obs =>
    sameCardName(obs, card) &&
    normalize(obs.edition) === normalize(card.edition) &&
    normalize(obs.langue) === normalize(card.langue)
  );
}

function observationsForCardCondition(card, condition, observations) {
  return observationsForCard(card, observations)
    .filter(obs => normalize(obs.condition) === normalize(condition));
}

function observedAverage(card, condition, observations) {
  const rows = observationsForCardCondition(card, condition, observations);

  const avg = weightedAverage(
    rows,
    obs => obs.observedMinPrice,
    obs => obs.observationDate || obs.date || obs.createdAt
  );

  if (!avg) {
    return {
      value: null,
      observationCount: 0,
      newestAge: null
    };
  }

  const newestAge = Math.min(
    ...rows.map(obs => daysOld(obs.observationDate || obs.date || obs.createdAt))
  );

  return {
    value: Number(avg.toFixed(2)),
    observationCount: rows.length,
    newestAge
  };
}

module.exports = {
  readObservations,
  observationsForCard,
  observationsForCardCondition,
  observedAverage
};