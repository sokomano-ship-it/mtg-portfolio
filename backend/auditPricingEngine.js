const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");

const FILES = {
    cards: "frontend/data/cards.json",
    pricingSimulation: "backend/data/pricingSimulation.json",
    pricingModels: "backend/data/pricingModels.json",
    observations: "backend/data/marketObservations.json"
};

function loadJson(relativePath) {
    const file = path.join(ROOT, relativePath);

    if (!fs.existsSync(file)) {
        throw new Error(`File not found : ${relativePath}`);
    }

    return JSON.parse(fs.readFileSync(file, "utf8"));
}

function printHeader(title) {
    console.log("");
    console.log(title);
    console.log("-".repeat(title.length));
}

function countPricingModels(simulation) {

    const counts = {};

    simulation.forEach(card => {

        const model = card.pricingModel || "unknown";

        counts[model] = (counts[model] || 0) + 1;

    });

    return counts;

}

function auditInventory(cards, simulation, observations) {

    printHeader("Inventory");

    console.log(`Cards                 : ${cards.length}`);
    console.log(`Pricing simulations   : ${simulation.length}`);
    console.log(`Observations          : ${observations.length}`);

}

function auditPricingModels(simulation) {

    printHeader("Pricing models");

    const counts = countPricingModels(simulation);

    Object.entries(counts)
        .sort((a, b) => b[1] - a[1])
        .forEach(([model, count]) => {

            console.log(model.padEnd(40, ".") + count);

        });

}

function auditKnowledge(simulation) {

    printHeader("Knowledge");

    let withTrend = 0;
    let withoutTrend = 0;

    let day0 = 0;
    let day1 = 0;
    let day2 = 0;
    let day3plus = 0;

    simulation.forEach(card => {

        if ((card.marketAnchorPrice || 0) > 0)
            withTrend++;
        else
            withoutTrend++;

        const days = card.observationDaysCount || 0;

        if (days === 0) day0++;
        else if (days === 1) day1++;
        else if (days === 2) day2++;
        else day3plus++;

    });

    console.log(`Trend available.......${withTrend}`);
    console.log(`Trend missing.........${withoutTrend}`);

    console.log("");

    console.log(`0 observation day.....${day0}`);
    console.log(`1 observation day.....${day1}`);
    console.log(`2 observation days....${day2}`);
    console.log(`3+ observation days...${day3plus}`);

}
function auditManualModels(simulation) {

    printHeader("Manual pricing");

    simulation
        .filter(card => (card.pricingModel || "").startsWith("manual"))
        .forEach(card => {

            console.log(
                `${card.nomCarte} | ${card.edition} | ${card.langue} | ${card.etat} | ${card.pricingModel}`
            );

        });

}
function auditMissingTrend(simulation) {

    printHeader("Missing trend");

    simulation
        .filter(card => (card.marketAnchorPrice || 0) === 0)
        .forEach(card => {

            console.log(
                `${card.nomCarte} | ${card.edition} | ${card.langue} | ${card.etat} | ${card.pricingModel}`
            );

        });

}
function auditReferenceCards(simulation) {
    printHeader("Reference mappings");

    const unique = new Map();

    simulation
        .filter(card =>
            card.usesExternalReference === true ||
            card.marketReferenceType === "no_market_reference"
        )
        .forEach(card => {
            const key = [
                card.nomCarte,
                card.edition,
                card.langue,
                card.etat,
                card.marketReferenceType,
                card.referenceName,
                card.referenceEdition,
                card.referenceLanguage
            ].join("|");

            if (!unique.has(key)) {
                unique.set(key, card);
            }
        });

    unique.forEach(card => {
        console.log(
            `${card.nomCarte} | ${card.edition} | ${card.langue} | ${card.etat}`
        );

        if (card.marketReferenceType === "no_market_reference") {
            console.log(" -> observations Admin uniquement");
        } else {
            console.log(
                ` -> ${card.referenceName || card.nomCarte} | ` +
                `${card.referenceEdition || "-"} | ` +
                `${card.referenceLanguage || "-"}`
            );
        }
    });
}


function main() {

    console.clear();

    console.log("");
    console.log("========================================");
    console.log(" MTG Portfolio - Pricing Engine Audit");
    console.log("========================================");

    const cardsJson = loadJson(FILES.cards);
    const simulation = loadJson(FILES.pricingSimulation);
    const observations = loadJson(FILES.observations);

    const cards = Array.isArray(cardsJson)
        ? cardsJson
        : (cardsJson.cards || []);

    auditInventory(cards, simulation, observations);

    auditPricingModels(simulation);
    auditKnowledge(simulation);

auditManualModels(simulation);
auditMissingTrend(simulation);
auditReferenceCards(simulation);

    console.log("");
    console.log("Audit completed.");

}

main();