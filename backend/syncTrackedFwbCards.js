const fs = require("fs");
const path = require("path");
const db = require("./database");

const TRACKED_PATH = path.join(__dirname, "data", "trackedMarketCards.json");

const SPECIAL_RULES = [
  {
    edition: "Foreign White Bordered",
    languages: ["French", "German", "Italian"],
    pricingModel: "fwb_revised_ratio"
  },
  {
    edition: "Legends",
    languages: ["Italian"],
    pricingModel: "legends_italian_ratio"
  }
];

function normalize(v) {
  return String(v || "").trim().toLowerCase();
}

function key(card) {
  return [normalize(card.nomCarte), normalize(card.edition), normalize(card.langue)].join("|");
}

function readJson(file, fallback) {
  if (!fs.existsSync(file)) return fallback;
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function isSpecial(card) {
  return SPECIAL_RULES.find(rule =>
    normalize(card.edition) === normalize(rule.edition) &&
    rule.languages.map(normalize).includes(normalize(card.langue))
  );
}

db.all("SELECT nomCarte, edition, langue FROM cards", [], (err, rows) => {
  if (err) {
    console.error(err.message);
    db.close();
    process.exit(1);
  }

  const tracked = readJson(TRACKED_PATH, []);
  const existing = new Set(tracked.map(key));
  let added = 0;

  rows.forEach(row => {
    const card = {
      nomCarte: String(row.nomCarte || "").trim(),
      edition: String(row.edition || "").trim(),
      langue: String(row.langue || "").trim()
    };

    const rule = isSpecial(card);
    if (!rule) return;

    const k = key(card);
    if (existing.has(k)) return;

    tracked.push({
      id: `special-${Date.now()}-${Math.random().toString(16).slice(2)}`,
      nomCarte: card.nomCarte,
      edition: card.edition,
      langue: card.langue,
      observable: true,
      priceMode: "manual",
      pricingModel: rule.pricingModel,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    });

    existing.add(k);
    added++;
  });

  fs.writeFileSync(TRACKED_PATH, JSON.stringify(tracked, null, 2));

  console.log(`Cartes spéciales ajoutées : ${added}`);
  console.log(`Total cartes suivies : ${tracked.length}`);

  db.close();
});