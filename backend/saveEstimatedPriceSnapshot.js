const fs = require("fs");
const path = require("path");

const SIMULATION_PATH = path.join(__dirname, "data", "pricingSimulation.json");
const OUTPUT_PATH = path.join(__dirname, "..", "frontend", "data", "estimated-price-history.json");

function readJson(file, fallback) {
    if (!fs.existsSync(file)) return fallback;
    return JSON.parse(fs.readFileSync(file, "utf8"));
}

function main() {
    const simulation = readJson(SIMULATION_PATH, []);
    const history = readJson(OUTPUT_PATH, []);

    const today = new Date().toISOString().slice(0, 10);

    const existingKeys = new Set(
        history.map(row => `${row.date}|${row.cardId}`)
    );

    const newRows = simulation.map(card => ({
    date: today,

    cardId: card.id,
    nomCarte: card.nomCarte,
    edition: card.edition,
    langue: card.langue,
    etat: card.etat,

    estimatedPrice: Number(card.estimatedPrice || 0),
    estimatedByCondition: card.estimatedByCondition || null,
    buyTargetByCondition: card.buyTargetByCondition || null,
    ratioByCondition: card.ratioByCondition || null,

    marketAnchorPrice: card.marketAnchorPrice || null,
    referenceMarketAnchorPrice: card.referenceMarketAnchorPrice || null,

    lastObservedMinByCondition: card.lastObservedMinByCondition || null,
    observedMinByCondition: card.observedMinByCondition || null,

    gradeModelConfidence: Number(card.gradeModelConfidence || card.confidence || 0),
    gradeModelSource: card.gradeModelSource || null,

    observationDaysCount: Number(card.observationDaysCount || 0),
    observationRowsCount: Number(card.observationRowsCount || 0),

    confidence: Number(card.confidence || card.gradeModelConfidence || 0),
    observationCount: Number(card.observationCount || 0),
    pricingModel: card.pricingModel || null,
    pricingRatio: card.ratioUsed ?? null
}));

    const merged = [...history];

    newRows.forEach(row => {
        const key = `${row.date}|${row.cardId}`;

        if (!existingKeys.has(key)) {
            merged.push(row);
            existingKeys.add(key);
        } else {
            const index = merged.findIndex(x => `${x.date}|${x.cardId}` === key);
            merged[index] = row;
        }
    });

    merged.sort((a, b) => {
        if (a.cardId !== b.cardId) return Number(a.cardId) - Number(b.cardId);
        return String(a.date).localeCompare(String(b.date));
    });

    fs.mkdirSync(path.dirname(OUTPUT_PATH), { recursive: true });
    fs.writeFileSync(OUTPUT_PATH, JSON.stringify(merged, null, 2), "utf8");

    console.log(`Historique V2 enregistré : ${OUTPUT_PATH}`);
    console.log(`${newRows.length} lignes ajoutées/mises à jour pour ${today}`);
}

main();