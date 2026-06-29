const fs = require("fs");
const path = require("path");
const db = require("../database");

const { getCardsWithLatestPrices, referencePrice } = require("./referencePrice");
const { readObservations } = require("./observations");
const { applyEditionModel } = require("./editionModel");
const { applyConditionModel } = require("./conditionModel");

const OUTPUT_PATH = path.join(__dirname, "..", "data", "pricingSimulation.json");

function finalConfidence(editionConfidence, conditionConfidence) {
  if (!editionConfidence || !conditionConfidence) {
    return Math.min(editionConfidence || 0, conditionConfidence || 0);
  }

  return Math.round((editionConfidence * 0.4) + (conditionConfidence * 0.6));
}

async function main() {
  const cards = await getCardsWithLatestPrices();
  const observations = readObservations();

  const results = cards.map(card => {
    const ref = referencePrice(card);

    const edition = applyEditionModel(
      card,
      cards,
      observations,
      ref.referencePrice
    );

    const condition = applyConditionModel(
      card,
      observations,
      edition.correctedReferencePrice
    );

    const confidence = finalConfidence(
      edition.editionConfidence,
      condition.conditionConfidence
    );

    return {
      id: card.id,
      nomCarte: card.nomCarte,
      edition: card.edition,
      langue: card.langue,
      etat: card.etat,

      referencePrice: ref.referencePrice,
      referenceSource: ref.referenceSource,

      editionModel: edition.editionModel,
      correctedReferencePrice: edition.correctedReferencePrice,
      editionRatio: edition.editionRatio,
      editionConfidence: edition.editionConfidence,
      editionObservationCount: edition.editionObservationCount,
      referenceCardFound: edition.referenceCardFound,

      conditionModel: condition.conditionModel,
      conditionRatio: condition.conditionRatio,
      estimatedPrice: condition.estimatedPrice,
      conditionConfidence: condition.conditionConfidence,
      conditionObservationCount: condition.conditionObservationCount,

      confidence
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