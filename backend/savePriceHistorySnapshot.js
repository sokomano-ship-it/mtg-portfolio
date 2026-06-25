const fs = require("fs");
const path = require("path");
const db = require("./database");

const outputDir = path.join(__dirname, "..", "frontend", "data");
const outputFile = path.join(outputDir, "price-history-snapshots.json");

function todayIsoDate() {
    return new Date().toISOString().slice(0, 10);
}

function loadExistingHistory() {
    if (!fs.existsSync(outputFile)) {
        return [];
    }

    try {
        return JSON.parse(fs.readFileSync(outputFile, "utf8"));
    } catch {
        return [];
    }
}

function saveHistory(history) {
    fs.mkdirSync(outputDir, { recursive: true });

    fs.writeFileSync(
        outputFile,
        JSON.stringify(history, null, 2),
        "utf8"
    );
}

function all(sql, params = []) {
    return new Promise((resolve, reject) => {
        db.all(sql, params, (err, rows) => {
            if (err) reject(err);
            else resolve(rows);
        });
    });
}

function snapshotKey(row) {
    return [
        row.date,
        row.cardmarketId,
        row.nomCarte,
        row.edition,
        row.version || "",
        row.langue || ""
    ].join("|");
}

async function main() {
    const date = todayIsoDate();

    const rows = await all(`
        SELECT
            c.cardmarketId,
            c.nomCarte,
            c.edition,
            c.version,
            c.langue,
            cp.trendPrice,
            cp.avg1,
            cp.avg7,
            cp.avg30,
            cp.lowPrice,
            cp.avgPrice
        FROM cards c
        LEFT JOIN cardmarket_prices cp
            ON cp.id = (
                SELECT MAX(id)
                FROM cardmarket_prices
                WHERE cardId = c.id
            )
        WHERE c.cardmarketId IS NOT NULL
        ORDER BY c.nomCarte, c.edition
    `);

    const existingHistory = loadExistingHistory();
    const existingKeys = new Set(existingHistory.map(snapshotKey));

    const newSnapshots = rows
        .filter(row => Number(row.trendPrice || 0) > 0)
        .map(row => ({
            date,
            cardmarketId: row.cardmarketId,
            nomCarte: row.nomCarte,
            edition: row.edition,
            version: row.version || "",
            langue: row.langue || "",
            trendPrice: Number(row.trendPrice || 0),
            avg1: Number(row.avg1 || 0),
            avg7: Number(row.avg7 || 0),
            avg30: Number(row.avg30 || 0),
            lowPrice: Number(row.lowPrice || 0),
            avgPrice: Number(row.avgPrice || 0)
        }))
        .filter(row => !existingKeys.has(snapshotKey(row)));

    const updatedHistory = [...existingHistory, ...newSnapshots];

    saveHistory(updatedHistory);

    console.log(`${newSnapshots.length} snapshot(s) prix ajoutés pour ${date}`);
    console.log(`${updatedHistory.length} ligne(s) historiques au total`);

    db.close();
}

main().catch(error => {
    console.error(error);
    process.exit(1);
});