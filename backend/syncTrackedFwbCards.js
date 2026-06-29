const fs = require("fs");
const path = require("path");
const db = require("./database");

const TRACKED_PATH = path.join(__dirname, "data", "trackedMarketCards.json");

const FWB_EDITION = "Foreign White Bordered";
const FWB_LANGUAGES = new Set(["French", "German", "Italian"]);

function normalize(value) {
  return String(value || "").trim().toLowerCase();
}

function key(card) {
  return [
    normalize(card.nomCarte),
    normalize(card.edition),
    normalize(card.langue)
  ].join("|");
}

function readTrackedCards() {
  if (!fs.existsSync(TRACKED_PATH)) return [];
  return JSON.parse(fs.readFileSync(TRACKED_PATH, "utf8"));
}

function writeTrackedCards(cards) {
  fs.writeFileSync(TRACKED_PATH, JSON.stringify(cards, null, 2));
}

db.all("SELECT nomCarte, edition, langue FROM cards", [], (err, rows) => {
  if (err) {
    console.error("Erreur lecture cards:", err.message);
    db.close();
    process.exit(1);
  }

  const tracked = readTrackedCards();
  const existingKeys = new Set(tracked.map(key));

  let added = 0;

  rows.forEach(row => {
    const card = {
      nomCarte: String(row.nomCarte || "").trim(),
      edition: String(row.edition || "").trim(),
      langue: String(row.langue || "").trim()
    };

    const isFwb =
      normalize(card.edition) === normalize(FWB_EDITION) &&
      FWB_LANGUAGES.has(card.langue);

    if (!isFwb) return;

    const cardKey = key(card);
    if (existingKeys.has(cardKey)) return;

    tracked.push({
      id: `fwb-${Date.now()}-${Math.random().toString(16).slice(2)}`,
      nomCarte: card.nomCarte,
      edition: card.edition,
      langue: card.langue,
      observable: true,
      priceMode: "manual",
      pricingModel: "fwb_revised_ratio",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    });

    existingKeys.add(cardKey);
    added++;
  });

  writeTrackedCards(tracked);

  console.log(`FWB ajoutées au catalogue suivi : ${added}`);
  console.log(`Total cartes suivies : ${tracked.length}`);

  db.close();
});