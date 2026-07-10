const fs = require("fs");
const path = require("path");

const FILES = [
  "frontend/data/cards.json",
  "backend/data/pricingSimulation.json",
  "backend/data/pricingModels.json",
  "backend/data/marketObservations.json"
];

console.log("");
console.log("========================================");
console.log(" MTG Portfolio - Pricing Engine Audit");
console.log("========================================");
console.log("");

FILES.forEach(file => {
  const fullPath = path.join(__dirname, "..", file);

  if (fs.existsSync(fullPath)) {
    console.log(`✓ ${file}`);
  } else {
    console.log(`✗ ${file} (introuvable)`);
  }
});

console.log("");
console.log("Audit terminé.");
console.log("");