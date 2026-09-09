const fs = require("fs");
const path = require("path");

const db = require("./database");
const turso = require("./turso");

const outputDir = path.join(
    __dirname,
    "..",
    "frontend",
    "data"
);

const outputFile = path.join(
    outputDir,
    "price-history-snapshots.json"
);

const BATCH_SIZE = 100;

function todayIsoDate() {
    return new Date()
        .toISOString()
        .slice(0, 10);
}

function loadExistingHistory() {

    if (!fs.existsSync(outputFile)) {
        return [];
    }

    try {
        return JSON.parse(
            fs.readFileSync(
                outputFile,
                "utf8"
            )
        );
    } catch {
        return [];
    }
}

function saveHistory(history) {

    fs.mkdirSync(
        outputDir,
        { recursive: true }
    );

    fs.writeFileSync(
        outputFile,
        JSON.stringify(
            history,
            null,
            2
        ),
        "utf8"
    );
}

function all(
    sql,
    params = []
) {
    return new Promise(
        (resolve, reject) => {

            db.all(
                sql,
                params,
                (err, rows) => {

                    if (err) {
                        reject(err);
                    } else {
                        resolve(rows);
                    }
                }
            );
        }
    );
}

function text(value) {

    return (
        value === null ||
        value === undefined
    )
        ? ""
        : String(value);
}

function snapshotKey(row) {

    return JSON.stringify([
        text(row.date),
        text(row.cardmarketId),
        text(row.nomCarte),
        text(row.edition),
        text(row.version),
        text(row.langue)
    ]);
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

async function saveSnapshotsToTurso(
    snapshots
) {

    if (snapshots.length === 0) {
        console.log(
            "Turso price history : aucun nouveau snapshot."
        );

        return;
    }

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
            chunk.map(row => ({

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
                    snapshotKey(row),

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
            }));

        await turso.batch(
            statements,
            "write"
        );
    }

    console.log(
        `Turso price history : ${snapshots.length} nouveau(x) snapshot(s) sauvegardé(s).`
    );
}

async function main() {

    const date =
        todayIsoDate();

    const rows =
        await all(`
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

            ORDER BY
                c.nomCarte,
                c.edition
        `);

    const existingHistory =
        loadExistingHistory();

    const existingKeys =
        new Set(
            existingHistory.map(
                snapshotKey
            )
        );

    /*
     * Déduplique également les lignes du jour entre elles.
     *
     * Plusieurs exemplaires d'une même carte dans la collection
     * peuvent produire exactement le même snapshot.
     */
    const newSnapshotMap =
        new Map();

    for (const row of rows) {

        if (
            Number(
                row.trendPrice || 0
            ) <= 0
        ) {
            continue;
        }

        const snapshot = {
            date,

            cardmarketId:
                row.cardmarketId,

            nomCarte:
                row.nomCarte,

            edition:
                row.edition,

            version:
                row.version || "",

            langue:
                row.langue || "",

            trendPrice:
                Number(
                    row.trendPrice || 0
                ),

            avg1:
                Number(
                    row.avg1 || 0
                ),

            avg7:
                Number(
                    row.avg7 || 0
                ),

            avg30:
                Number(
                    row.avg30 || 0
                ),

            lowPrice:
                Number(
                    row.lowPrice || 0
                ),

            avgPrice:
                Number(
                    row.avgPrice || 0
                )
        };

        const key =
            snapshotKey(
                snapshot
            );

        if (
            existingKeys.has(key)
        ) {
            continue;
        }

        if (
            !newSnapshotMap.has(key)
        ) {
            newSnapshotMap.set(
                key,
                snapshot
            );
        }
    }

    const newSnapshots =
        [...newSnapshotMap.values()];

    /*
     * Important :
     * Turso est écrit EN PREMIER.
     *
     * Si Turso échoue, le JSON n'est pas modifié.
     */
    await saveSnapshotsToTurso(
        newSnapshots
    );

    const updatedHistory = [
        ...existingHistory,
        ...newSnapshots
    ];

    saveHistory(
        updatedHistory
    );

    console.log(
        `${newSnapshots.length} snapshot(s) prix ajouté(s) pour ${date}`
    );

    console.log(
        `${updatedHistory.length} ligne(s) historiques au total`
    );

    db.close();
}

main().catch(error => {

    console.error("");
    console.error(
        "❌ Erreur savePriceHistorySnapshot :"
    );

    console.error(error);

    db.close();

    process.exit(1);
});