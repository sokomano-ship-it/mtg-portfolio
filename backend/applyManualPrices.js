console.log("applyManualPrices.js est désactivé : les prix manuels sont maintenant utilisés uniquement comme fallback dans le moteur V2.");
process.exit(0);

const fs = require("fs");
const path = require("path");
const db = require("./database");

const manualPricesPath = path.join(__dirname, "data", "manualPrices.json");
const marketObservationsPath = path.join(__dirname, "data", "marketObservations.json");


function normalize(value) {
    return String(value || "")
        .trim()
        .toLowerCase()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "");
}

function readJson(filePath, fallback) {
    if (!fs.existsSync(filePath)) return fallback;
    try {
        return JSON.parse(fs.readFileSync(filePath, "utf8"));
    } catch {
        return fallback;
    }
}

function number(value) {
    return Number(value) || 0;
}

function matches(card, ref) {
    return normalize(card.nomCarte) === normalize(ref.nomCarte)
        && normalize(card.edition) === normalize(ref.edition)
        && normalize(card.langue) === normalize(ref.langue);
}

function all(sql, params = []) {
    return new Promise((resolve, reject) => {
        db.all(sql, params, (err, rows) => {
            if (err) reject(err);
            else resolve(rows || []);
        });
    });
}

function run(sql, params = []) {
    return new Promise((resolve, reject) => {
        db.run(sql, params, function (err) {
            if (err) reject(err);
            else resolve(this);
        });
    });
}

function latestObservationPrice(card, observations) {
    const rows = observations
        .filter(obs => matches(card, obs))
        .filter(obs => ["NM", "EX"].includes(String(obs.condition || "").toUpperCase()))
        .filter(obs => number(obs.observedMinPrice) > 0)
        .sort((a, b) =>
            String(b.observationDate || b.date || "").localeCompare(String(a.observationDate || a.date || ""))
        );

    if (!rows.length) return null;

    const nmRows = rows.filter(row => String(row.condition).toUpperCase() === "NM");
    const exRows = rows.filter(row => String(row.condition).toUpperCase() === "EX");

    const nm = nmRows[0] ? number(nmRows[0].observedMinPrice) : 0;
    const ex = exRows[0] ? number(exRows[0].observedMinPrice) : 0;

    const trendPrice = nm || ex;

    return {
        trendPrice,
        avg1: trendPrice,
        avg7: trendPrice,
        avg30: trendPrice,
        source: nm ? "marketObservations NM" : "marketObservations EX"
    };
}

function manualJsonPrice(card, manualPrices) {
    const manual = manualPrices.find(price => matches(card, price));
    if (!manual) return null;

    const trendPrice = number(manual.trendPrice);
    if (trendPrice <= 0) return null;

    return {
        trendPrice,
        avg1: number(manual.avg1 || manual.trendPrice),
        avg7: number(manual.avg7 || manual.trendPrice),
        avg30: number(manual.avg30 || manual.trendPrice),
        source: "manualPrices.json"
    };
}

async function main() {
    const manualPrices = readJson(manualPricesPath, []);
    const observations = readJson(marketObservationsPath, []);

    const cards = await all("SELECT * FROM cards");

    let updated = 0;
    let skipped = 0;

    for (const card of cards) {
        const price =
            manualJsonPrice(card, manualPrices) ||
            latestObservationPrice(card, observations);

        if (!price || number(price.trendPrice) <= 0) {
            const isManualCandidate =
                manualPrices.some(ref => matches(card, ref)) ||
                observations.some(obs => matches(card, obs));

            if (isManualCandidate) {
                skipped++;
                console.log(`⚠️ Prix manuel non renseigné : ${card.nomCarte} | ${card.edition} | ${card.langue}`);
            }

            continue;
        }

        await run(
    `
    INSERT INTO cardmarket_prices (
        cardId,
        date,
        trendPrice,
        avg1,
        avg7,
        avg30,
        lowPrice,
        avgPrice,
        createdAt
    )
    VALUES (?, date('now'), ?, ?, ?, ?, ?, ?, datetime('now'))
    `,
    [
        card.id,
        price.trendPrice,
        price.avg1,
        price.avg7,
        price.avg30,
        price.trendPrice,
        price.trendPrice
    ]
);

        updated++;
        console.log(`✅ Prix manuel appliqué (${price.source}) : ${card.nomCarte} | ${card.edition} | ${card.langue}`);
    }

    console.log(`${updated} prix manuel(s) appliqué(s).`);
    console.log(`${skipped} prix manuel(s) ignoré(s).`);

    db.close();
}

main().catch(error => {
    console.error(error);
    db.close();
    process.exit(1);
});