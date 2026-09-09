require("dotenv").config();

const fs = require("fs");
const path = require("path");

const db = require("./turso");

const FILE = path.join(
    __dirname,
    "..",
    "frontend",
    "data",
    "tracked-price-history.json"
);

const BATCH_SIZE = 100;

async function main() {
    const history =
        JSON.parse(
            fs.readFileSync(
                FILE,
                "utf8"
            )
        );

    const statements = [];

    for (const row of history) {
        if (
            row.trackedId === null ||
            row.trackedId === undefined ||
            !row.date
        ) {
            continue;
        }

        statements.push({
            sql: `
                UPDATE tracked_price_history
                SET snapshot_json = ?
                WHERE tracked_id = ?
                  AND date = ?
            `,
            args: [
                JSON.stringify(row),
                String(row.trackedId),
                row.date
            ]
        });
    }

    for (
        let i = 0;
        i < statements.length;
        i += BATCH_SIZE
    ) {
        await db.batch(
            statements.slice(
                i,
                i + BATCH_SIZE
            ),
            "write"
        );
    }

    const result =
        await db.execute(`
            SELECT
                COUNT(*) AS total,
                SUM(
                    CASE
                        WHEN snapshot_json IS NOT NULL
                        THEN 1
                        ELSE 0
                    END
                ) AS full_snapshots
            FROM tracked_price_history
        `);

    console.log(
        "Lignes Turso       :",
        result.rows[0].total
    );

    console.log(
        "Snapshots complets :",
        result.rows[0].full_snapshots
    );

    console.log(
        "Source JSON        :",
        history.length
    );

    if (
        Number(result.rows[0].full_snapshots) !==
        history.length
    ) {
        throw new Error(
            "Le nombre de snapshots complets ne correspond pas au JSON source."
        );
    }

    console.log(
        "✅ Les snapshots tracked complets sont maintenant sauvegardés dans Turso."
    );
}

main().catch(error => {
    console.error(error);
    process.exit(1);
});