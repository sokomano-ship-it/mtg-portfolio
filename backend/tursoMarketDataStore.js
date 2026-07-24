const db = require("./turso");

function rowToObservation(row) {
  return {
    id: row.id,
    observationDate: row.observation_date,

    nomCarte: row.card_name,
    edition: row.edition,
    langue: row.language,
    condition: row.condition,

    observedMinPrice: Number(row.observed_min_price || 0),

    marketSnapshot: {
      trendPrice: Number(row.trend_price || 0),
      avg30: Number(row.avg_30 || 0),
      avg7: Number(row.avg_7 || 0),
      avg1: Number(row.avg_1 || 0)
    },

    ratios: {
      vsTrendPrice:
        row.ratio_vs_trend === null
          ? null
          : Number(row.ratio_vs_trend),

      vsAvg30:
        row.ratio_vs_avg_30 === null
          ? null
          : Number(row.ratio_vs_avg_30),

      vsAvg7:
        row.ratio_vs_avg_7 === null
          ? null
          : Number(row.ratio_vs_avg_7),

      vsAvg1:
        row.ratio_vs_avg_1 === null
          ? null
          : Number(row.ratio_vs_avg_1)
    },

    source: row.source,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function rowToTrackedCard(row) {
  return {
    id: row.id,
    nomCarte: row.card_name,
    edition: row.edition,
    langue: row.language,
    observable: Boolean(row.observable),
    priceMode: row.price_mode,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

async function loadMarketObservations() {
  const result = await db.execute(`
    SELECT
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
    FROM market_observations
    ORDER BY observation_date DESC, created_at DESC
  `);

  return result.rows.map(rowToObservation);
}

async function loadTrackedMarketCards() {
  const result = await db.execute(`
    SELECT
      id,
      card_name,
      edition,
      language,
      observable,
      price_mode,
      created_at,
      updated_at
    FROM tracked_market_cards
    ORDER BY card_name, edition, language
  `);

  return result.rows.map(rowToTrackedCard);
}

async function addMarketObservation(observation) {
  await db.execute({
    sql: `
      INSERT INTO market_observations (
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
      observation.id,
      observation.observationDate,
      observation.nomCarte,
      observation.edition,
      observation.langue,
      observation.condition,
      observation.observedMinPrice,

      observation.marketSnapshot.trendPrice,
      observation.marketSnapshot.avg30,
      observation.marketSnapshot.avg7,
      observation.marketSnapshot.avg1,

      observation.ratios.vsTrendPrice,
      observation.ratios.vsAvg30,
      observation.ratios.vsAvg7,
      observation.ratios.vsAvg1,

      observation.source,
      observation.createdAt,
      observation.updatedAt
    ]
  });
}

async function deleteMarketObservation(id) {
  await db.execute({
    sql: "DELETE FROM market_observations WHERE id = ?",
    args: [id]
  });
}

async function deleteMarketObservations(ids) {
  if (!Array.isArray(ids) || ids.length === 0) {
    return;
  }

  await db.batch(
    ids.map(id => ({
      sql: "DELETE FROM market_observations WHERE id = ?",
      args: [id]
    })),
    "write"
  );
}

async function deleteCardObservations(card) {
  await db.execute({
    sql: `
      DELETE FROM market_observations
      WHERE lower(trim(card_name)) = lower(trim(?))
        AND lower(trim(edition)) = lower(trim(?))
        AND lower(trim(language)) = lower(trim(?))
    `,
    args: [
      card.nomCarte,
      card.edition,
      card.langue
    ]
  });
}

async function saveTrackedCard(card) {
  await db.execute({
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
        id = excluded.id,
        observable = excluded.observable,
        price_mode = excluded.price_mode,
        updated_at = excluded.updated_at
    `,
    args: [
      card.id,
      card.nomCarte,
      card.edition,
      card.langue,
      card.observable ? 1 : 0,
      card.priceMode,
      card.createdAt,
      card.updatedAt
    ]
  });
}

async function deleteTrackedCard(id) {
  await db.execute({
    sql: "DELETE FROM tracked_market_cards WHERE id = ?",
    args: [id]
  });
}

async function deleteTrackedCardByIdentity(card) {
  await db.execute({
    sql: `
      DELETE FROM tracked_market_cards
      WHERE lower(trim(card_name)) = lower(trim(?))
        AND lower(trim(edition)) = lower(trim(?))
        AND lower(trim(language)) = lower(trim(?))
    `,
    args: [
      card.nomCarte,
      card.edition,
      card.langue
    ]
  });
}

module.exports = {
  loadMarketObservations,
  loadTrackedMarketCards,
  addMarketObservation,
  deleteMarketObservation,
  deleteMarketObservations,
  deleteCardObservations,
  saveTrackedCard,
  deleteTrackedCard,
  deleteTrackedCardByIdentity
};