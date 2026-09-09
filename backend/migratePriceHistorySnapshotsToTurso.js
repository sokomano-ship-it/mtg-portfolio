require("dotenv").config();

const fs = require("fs");
const path = require("path");

const db = require("./turso");

const ROOT = path.join(__dirname, "..");

const INPUT_PATH = path.join(
    ROOT,
    "frontend",
    "data",
    "price-history-snapshots.json"
);

const BATCH_SIZE = 100;

function text(value) {
    return value === null ||
           value === undefined
        ? ""
        : String(value);
}

function numberOrNull(value) {

    if (
        value === null ||
        value === undefined ||
        value === ""
    ) {
        return null;
    }

    const n = Number(value);

    return Number.isFinite(n)
        ? n
        : null;
}

function makeSnapshotKey(row) {

    return JSON.stringify([
        text(row.date),
        text(row.cardmarketId),
        text(row.nomCarte),
        text(row.edition),
        text(row.version),
        text(row.langue)
    ]);
}

async function main() {

    console.log(
        "Migration price-history-snapshots.json vers Turso..."
    );

    const source = JSON.parse(
        fs.readFileSync(
            INPUT_PATH,
            "utf8"
        )
    );

    if (!Array.isArray(source)) {
        throw new Error(
            "price-history-snapshots.json doit être un tableau."
        );
    }

    /*
     * Les doublons historiques sont strictement identiques.
     * On garde une seule observation par identité.
     */
    const uniqueMap = new Map();

    for (const row of source) {

        const key =
            makeSnapshotKey(row);

        if (!uniqueMap.has(key)) {
            uniqueMap.set(
                key,
                row
            );
        }
    }

    const snapshots =
        [...uniqueMap.entries()].map(
            ([snapshotKey, row]) => ({
                snapshotKey,
                row
            })
        );

    console.log(
        `Lignes source       : ${source.length}`
    );

    console.log(
        `Snapshots uniques   : ${snapshots.length}`
    );

    console.log(
        `Doublons supprimés  : ${
            source.length -
            snapshots.length
        }`
    );

    let migrated = 0;

    for (
        let i = 0;
        i < snapshots.length;
        i += BATCH_SIZE
    ) {

        const chunk =
            snapshots.slice(
                i,
                i + BATCH_SIZE
            );

        const statements =
            chunk.map(
                ({
                    snapshotKey,
                    row
                }) => ({
                    sql: `
                        INSERT INTO price_history_snapshots (
                            snapshot_key,

                            cardmarket_id,
                            date,

                            nom_carte,
                            edition,
                            version,
                            langue,

                            trend_price,
                            avg_1,
                            avg_7,
                            avg_30,
                            low_price,
                            avg_price,

                            snapshot_json
                        )
                        VALUES (
                            ?,
                            ?, ?,
                            ?, ?, ?, ?,
                            ?, ?, ?, ?, ?, ?,
                            ?
                        )

                        ON CONFLICT(snapshot_key)
                        DO UPDATE SET

                            cardmarket_id =
                                excluded.cardmarket_id,

                            date =
                                excluded.date,

                            nom_carte =
                                excluded.nom_carte,

                            edition =
                                excluded.edition,

                            version =
                                excluded.version,

                            langue =
                                excluded.langue,

                            trend_price =
                                excluded.trend_price,

                            avg_1 =
                                excluded.avg_1,

                            avg_7 =
                                excluded.avg_7,

                            avg_30 =
                                excluded.avg_30,

                            low_price =
                                excluded.low_price,

                            avg_price =
                                excluded.avg_price,

                            snapshot_json =
                                excluded.snapshot_json
                    `,

                    args: [
                        snapshotKey,

                        text(
                            row.cardmarketId
                        ),

                        text(
                            row.date
                        ),

                        text(
                            row.nomCarte
                        ),

                        text(
                            row.edition
                        ),

                        text(
                            row.version
                        ),

                        text(
                            row.langue
                        ),

                        numberOrNull(
                            row.trendPrice
                        ),

                        numberOrNull(
                            row.avg1
                        ),

                        numberOrNull(
                            row.avg7
                        ),

                        numberOrNull(
                            row.avg30
                        ),

                        numberOrNull(
                            row.lowPrice
                        ),

                        numberOrNull(
                            row.avgPrice
                        ),

                        JSON.stringify(row)
                    ]
                })
            );

        await db.batch(
            statements,
            "write"
        );

        migrated +=
            chunk.length;

        if (
            migrated % 5000 === 0 ||
            migrated === snapshots.length
        ) {
            console.log(
                `${migrated}/${snapshots.length}`
            );
        }
    }

    const result =
        await db.execute(`
            SELECT
                COUNT(*) AS n,
                COUNT(snapshot_json) AS full_snapshots,
                MIN(date) AS first_date,
                MAX(date) AS last_date
            FROM price_history_snapshots
        `);

    const row =
        result.rows[0];

    console.log("");
    console.log(
        `Source JSON        : ${source.length}`
    );

    console.log(
        `Source unique      : ${snapshots.length}`
    );

    console.log(
        `Lignes Turso       : ${row.n}`
    );

    console.log(
        `Snapshots complets : ${row.full_snapshots}`
    );

    console.log(
        `Première date      : ${row.first_date}`
    );

    console.log(
        `Dernière date      : ${row.last_date}`
    );

    if (
        Number(row.n) !==
        snapshots.length
    ) {
        throw new Error(
            "Le nombre de snapshots Turso est incorrect."
        );
    }

    if (
        Number(row.full_snapshots) !==
        snapshots.length
    ) {
        throw new Error(
            "Certains snapshot_json sont absents."
        );
    }

    console.log("");
    console.log(
        "✅ Historique price history migré sans doublons vers Turso."
    );
}

main().catch(error => {

    console.error("");
    console.error(
        "❌ Erreur migration price history :"
    );

    console.error(error);

    process.exit(1);
});