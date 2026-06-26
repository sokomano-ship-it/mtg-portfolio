const fs = require("fs");
const path = require("path");
const db = require("./database");

const manualPricesPath = path.join(__dirname, "data", "manualPrices.json");

function normalize(value) {
    return String(value || "").trim().toLowerCase();
}

function loadManualPrices() {
    if (!fs.existsSync(manualPricesPath)) return [];

    try {
        return JSON.parse(fs.readFileSync(manualPricesPath, "utf8"));
    } catch {
        return [];
    }
}

function matches(card, manual) {
    if (normalize(card.nomCarte) !== normalize(manual.nomCarte)) return false;
    if (manual.edition && normalize(card.edition) !== normalize(manual.edition)) return false;
    if (manual.langue && normalize(card.langue) !== normalize(manual.langue)) return false;

    return true;
}

function matchesManualPrice(source, copyFrom) {
    if (!copyFrom) return false;

    if (normalize(source.nomCarte) !== normalize(copyFrom.nomCarte)) return false;
    if (copyFrom.edition && normalize(source.edition) !== normalize(copyFrom.edition)) return false;
    if (copyFrom.langue && normalize(source.langue) !== normalize(copyFrom.langue)) return false;

    return true;
}

function resolveManualPrice(manual, manualPrices) {
    if (!manual.copyFrom) return manual;

    return manualPrices.find(source =>
        matchesManualPrice(source, manual.copyFrom)
    );
}

function number(value) {
    return Number(value) || 0;
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

async function main() {
    const manualPrices = loadManualPrices();

    if (!manualPrices.length) {
        console.log("Aucun prix manuel défini.");
        db.close();
        return;
    }

    const cards = await all("SELECT * FROM cards");

    let updated = 0;
    let skipped = 0;

    for (const card of cards) {
        const manual = manualPrices.find(price => matches(card, price));

        if (!manual) continue;

        const source = resolveManualPrice(manual, manualPrices);

        if (!source) {
            skipped++;
            console.log(`⚠️ Source manuelle introuvable : ${card.nomCarte} | ${card.edition} | ${card.langue}`);
            continue;
        }

        const trendPrice = number(source.trendPrice);
        const avg1 = number(source.avg1 || source.trendPrice);
        const avg7 = number(source.avg7 || source.trendPrice);
        const avg30 = number(source.avg30 || source.trendPrice);

        if (trendPrice <= 0) {
            skipped++;
            console.log(`⚠️ Prix manuel non renseigné : ${card.nomCarte} | ${card.edition} | ${card.langue}`);
            continue;
        }

        await run(
            `
            INSERT INTO cardmarket_prices (
                cardId,
                trendPrice,
                avg1,
                avg7,
                avg30,
                lowPrice,
                avgPrice,
                createdAt
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))
            `,
            [
                card.id,
                trendPrice,
                avg1,
                avg7,
                avg30,
                trendPrice,
                trendPrice
            ]
        );

        updated++;
        console.log(`✅ Prix manuel appliqué : ${card.nomCarte} | ${card.edition} | ${card.langue}`);
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