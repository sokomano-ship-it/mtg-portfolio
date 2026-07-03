const fs = require("fs");
const path = require("path");

const marketObservationsPath = path.join(__dirname, "..", "data", "marketObservations.json");
const manualPricesPath = path.join(__dirname, "..", "data", "manualPrices.json");

const db = require("../database");

function getCardsWithLatestPrices() {
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

function readJson(filePath, fallback) {
    if (!fs.existsSync(filePath)) return fallback;
    try {
        return JSON.parse(fs.readFileSync(filePath, "utf8"));
    } catch {
        return fallback;
    }
}

function normalize(value) {
    return String(value || "")
        .trim()
        .toLowerCase()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "");
}

function sameCard(a, b) {
    return normalize(a.nomCarte) === normalize(b.nomCarte)
        && normalize(a.edition) === normalize(b.edition)
        && normalize(a.langue) === normalize(b.langue);
}

function getManualFallbackPrice(card) {
    const observations = readJson(marketObservationsPath, []);
    const manualPrices = readJson(manualPricesPath, []);

    const manual = manualPrices.find(row => sameCard(card, row));
    if (manual && Number(manual.trendPrice || 0) > 0) {
        return {
            trendPrice: Number(manual.trendPrice),
            avg1: Number(manual.avg1 || manual.trendPrice),
            avg7: Number(manual.avg7 || manual.trendPrice),
            avg30: Number(manual.avg30 || manual.trendPrice),
            priceSource: "manualPrices"
        };
    }

    const rows = observations
        .filter(row => sameCard(card, row))
        .filter(row => ["NM", "EX"].includes(String(row.condition || "").toUpperCase()))
        .filter(row => Number(row.observedMinPrice || 0) > 0)
        .sort((a, b) =>
            String(b.observationDate || b.date || "").localeCompare(String(a.observationDate || a.date || ""))
        );

    if (!rows.length) return null;

    const nm = rows.find(row => String(row.condition).toUpperCase() === "NM");
    const ex = rows.find(row => String(row.condition).toUpperCase() === "EX");

    const price = Number(nm?.observedMinPrice || ex?.observedMinPrice || 0);

    if (!price) return null;

    return {
        trendPrice: price,
        avg1: price,
        avg7: price,
        avg30: price,
        priceSource: nm ? "marketObservationNM" : "marketObservationEX"
    };
}

function referencePrice(card) {
  const value =
    Number(card.trendPrice || 0) ||
    Number(card.avg30 || 0) ||
    Number(card.avg7 || 0) ||
    Number(card.avg1 || 0) ||
    Number(card.avgPrice || 0) ||
    Number(card.lowPrice || 0) ||
    0;

  return {
    referencePrice: value,
    referenceSource: value ? "cardmarket_reference" : "missing_reference"
  };
  return getManualFallbackPrice(card);
}

module.exports = {
  getCardsWithLatestPrices,
  referencePrice
};