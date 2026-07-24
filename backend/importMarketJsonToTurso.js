require("dotenv").config();

const fs = require("fs");
const path = require("path");
const db = require("./turso");

const OBSERVATIONS_FILE = path.join(
  __dirname,
  "data",
  "marketObservations.json"
);

const TRACKED_CARDS_FILE = path.join(
  __dirname,
  "data",
  "trackedMarketCards.json"
);

function readJsonArray(filePath) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`Fichier introuvable : ${filePath}`);
  }

  const content = fs.readFileSync(filePath, "utf8");

  if (!content.trim()) {
    throw new Error(`Le fichier est vide : ${filePath}`);
  }

  const json = JSON.parse(content);

  if (!Array.isArray(json)) {
    throw new Error(
      `Le fichier doit contenir un tableau JSON : ${filePath}`
    );
  }

  return json;
}

function nullableNumber(value) {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  const number = Number(value);

  return Number.isFinite(number) ? number : null;
}

function requiredText(value, fieldName, itemId) {
  const text = String(value || "").trim();

  if (!text) {
    throw new Error(
      `Champ obligatoire manquant : ${fieldName} pour l’élément ${itemId}`
    );
  }

  return text;
}

function buildObservationStatement(observation) {
  const itemId = observation.id || "sans identifiant";
  const marketSnapshot = observation.marketSnapshot || {};
  const ratios = observation.ratios || {};

  return {
    sql: `
      INSERT OR IGNORE INTO market_observations (
        id,
        observation_date,
        card_name,
        edition,
        language,
        condition,
        observed_min_price,
        trend_price,
        avg_30,
        avg_7,
        avg_1,
        ratio_vs_trend,
        ratio_vs_avg_30,
        ratio_vs_avg_7,
        ratio_vs_avg_1,
        source,
        created_at,
        updated_at
      )
      VALUES (
        ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
        ?, ?, ?, ?, ?, ?, ?, ?
      )
    `,
    args: [
      requiredText(observation.id, "id", itemId),
      requiredText(
        observation.observationDate,
        "observationDate",
        itemId
      ),
      requiredText(observation.nomCarte, "nomCarte", itemId),
      requiredText(observation.edition, "edition", itemId),
      requiredText(observation.langue, "langue", itemId),
      requiredText(observation.condition, "condition", itemId),

      Number(observation.observedMinPrice || 0),

      Number(marketSnapshot.trendPrice || 0),
      Number(marketSnapshot.avg30 || 0),
      Number(marketSnapshot.avg7 || 0),
      Number(marketSnapshot.avg1 || 0),

      nullableNumber(ratios.vsTrendPrice),
      nullableNumber(ratios.vsAvg30),
      nullableNumber(ratios.vsAvg7),
      nullableNumber(ratios.vsAvg1),

      String(observation.source || "Cardmarket"),
      observation.createdAt || new Date().toISOString(),
      observation.updatedAt ||
        observation.createdAt ||
        new Date().toISOString()
    ]
  };
}

function buildTrackedCardStatement(card) {
  const itemId = card.id || "sans identifiant";

  return {
    sql: `
      INSERT INTO tracked_market_cards (
        id,
        card_name,
        edition,
        language,
        observable,
        price_mode,
        created_at,
        updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)

      ON CONFLICT(card_name, edition, language)
      DO UPDATE SET
        observable = excluded.observable,
        price_mode = excluded.price_mode,
        updated_at = excluded.updated_at
    `,
    args: [
      requiredText(card.id, "id", itemId),
      requiredText(card.nomCarte, "nomCarte", itemId),
      requiredText(card.edition, "edition", itemId),
      requiredText(card.langue, "langue", itemId),
      card.observable ? 1 : 0,
      card.priceMode === "manual" ? "manual" : "automatic",
      card.createdAt || new Date().toISOString(),
      card.updatedAt ||
        card.createdAt ||
        new Date().toISOString()
    ]
  };
}

async function executeInChunks(statements, chunkSize = 100) {
  for (let index = 0; index < statements.length; index += chunkSize) {
    const chunk = statements.slice(index, index + chunkSize);

    await db.batch(chunk, "write");

    console.log(
      `  ${Math.min(index + chunk.length, statements.length)}` +
      ` / ${statements.length}`
    );
  }
}

async function getTableCount(tableName) {
  const allowedTables = new Set([
    "market_observations",
    "tracked_market_cards"
  ]);

  if (!allowedTables.has(tableName)) {
    throw new Error(`Table non autorisée : ${tableName}`);
  }

  const result = await db.execute(
    `SELECT COUNT(*) AS total FROM ${tableName}`
  );

  return Number(result.rows[0].total);
}

async function main() {
  console.log("Lecture des fichiers JSON...");

  const observations = readJsonArray(OBSERVATIONS_FILE);
  const trackedCards = readJsonArray(TRACKED_CARDS_FILE);

  console.log(`Observations JSON : ${observations.length}`);
  console.log(`Cartes suivies JSON : ${trackedCards.length}`);

  const observationsBefore = await getTableCount(
    "market_observations"
  );

  const trackedCardsBefore = await getTableCount(
    "tracked_market_cards"
  );

  console.log("\nAvant import Turso :");
  console.log(`Observations : ${observationsBefore}`);
  console.log(`Cartes suivies : ${trackedCardsBefore}`);

  console.log("\nImport des observations...");

  await executeInChunks(
    observations.map(buildObservationStatement)
  );

  console.log("\nImport des cartes suivies...");

  await executeInChunks(
    trackedCards.map(buildTrackedCardStatement)
  );

  const observationsAfter = await getTableCount(
    "market_observations"
  );

  const trackedCardsAfter = await getTableCount(
    "tracked_market_cards"
  );

  console.log("\nAprès import Turso :");
  console.log(`Observations : ${observationsAfter}`);
  console.log(`Cartes suivies : ${trackedCardsAfter}`);

  console.log("\nComparaison :");

  console.log(
    observationsAfter === observations.length
      ? "✅ Nombre d’observations identique"
      : "⚠️ Le nombre d’observations est différent"
  );

  console.log(
    trackedCardsAfter === trackedCards.length
      ? "✅ Nombre de cartes suivies identique"
      : "⚠️ Le nombre de cartes suivies est différent"
  );

  console.log("\nImport terminé.");
}

main().catch(error => {
  console.error("\n❌ Import échoué :");
  console.error(error);
  process.exitCode = 1;
});