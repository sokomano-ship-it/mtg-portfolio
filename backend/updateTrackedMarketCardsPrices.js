const fs = require("fs");
const path = require("path");
const axios = require("axios");

const TRACKED_PATH = path.join(__dirname, "data", "trackedMarketCards.json");

const PRICE_GUIDE_URL =
  "https://downloads.s3.cardmarket.com/productCatalog/priceGuide/price_guide_1.json";

function readJson(file, fallback) {
  if (!fs.existsSync(file)) return fallback;
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function saveJson(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2), "utf8");
}

function number(value) {
  return Number(value || 0);
}

async function main() {
  const trackedCards = readJson(TRACKED_PATH, []);

  console.log("Téléchargement du Price Guide Cardmarket...");
  const response = await axios.get(PRICE_GUIDE_URL, { timeout: 60000 });

  const priceGuide = Array.isArray(response.data)
    ? response.data
    : response.data.priceGuides || response.data.products || [];

  const priceById = new Map(
    priceGuide.map(row => [Number(row.idProduct), row])
  );

  let updated = 0;
  let missing = 0;
  let skipped = 0;

  const enriched = trackedCards.map(card => {
    if (card.priceMode === "manual" || card.pricingModel?.includes("fwb")) {
      skipped += 1;
      return card;
    }

    const cardmarketId = Number(card.cardmarketId || card.idProduct || 0);

    if (!cardmarketId) {
      missing += 1;
      return card;
    }

    const price = priceById.get(cardmarketId);

    if (!price) {
      missing += 1;
      return card;
    }

    updated += 1;

    return {
      ...card,
      trendPrice: number(price.trend),
      lowPrice: number(price.low),
      avgPrice: number(price.avg),
      avg1: number(price.avg1),
      avg7: number(price.avg7),
      avg30: number(price.avg30),
      priceUpdatedAt: new Date().toISOString()
    };
  });

  saveJson(TRACKED_PATH, enriched);

  console.log(`Cartes suivies mises à jour : ${updated}`);
  console.log(`Cartes suivies sans prix : ${missing}`);
  console.log(`Cartes manuelles ignorées : ${skipped}`);
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});