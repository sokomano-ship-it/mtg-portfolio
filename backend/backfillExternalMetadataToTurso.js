require("dotenv").config();

const fs = require("fs");
const path = require("path");

const db = require("./turso");

const ROOT = path.join(__dirname, "..");

const HISTORY_PATH = path.join(
    ROOT,
    "frontend",
    "data",
    "external-market-history.json"
);


async function main() {

    console.log(
        "Backfill métadonnées external market vers Turso..."
    );

    if (!fs.existsSync(HISTORY_PATH)) {
        throw new Error(
            `Fichier introuvable : ${HISTORY_PATH}`
        );
    }

    const history =
        JSON.parse(
            fs.readFileSync(
                HISTORY_PATH,
                "utf8"
            )
        );


    const metadata = {
    "external_market.version":
        history.version ?? 1,

    "external_market.tcgBackfillCompleted":
        history.tcgBackfillCompleted ?? false,

    "external_market.updatedAt":
        history.updatedAt ?? null,

    "external_market.usdEur":
        history.usdEur ?? null,

    "external_market.cardmarketMetric":
        history.cardmarketMetric ?? null,

    "external_market.cardmarketTrendBackfillCompleted":
        history.cardmarketTrendBackfillCompleted ??
        false
};


    const statements =
        Object.entries(metadata)
            .map(([key, value]) => ({
                sql: `
                    INSERT INTO storage_metadata (
                        key,
                        value,
                        updated_at
                    )
                    VALUES (?, ?, CURRENT_TIMESTAMP)

                    ON CONFLICT(key)
                    DO UPDATE SET
                        value = excluded.value,
                        updated_at = CURRENT_TIMESTAMP
                `,
                args: [
                    key,
                    value === null
                        ? null
                        : JSON.stringify(value)
                ]
            }));


    await db.batch(
        statements,
        "write"
    );


    console.log(
        `Métadonnées sauvegardées : ${statements.length}`
    );


    const result =
        await db.execute(`
            SELECT
                key,
                value
            FROM storage_metadata
            WHERE key LIKE 'external_market.%'
            ORDER BY key
        `);


    console.log("");

    for (const row of result.rows) {
        console.log(
            `${row.key} = ${row.value}`
        );
    }

    console.log("");
    console.log(
        "✅ Métadonnées external market sauvegardées dans Turso."
    );
}


main().catch(error => {

    console.error("");
    console.error(
        "❌ Erreur backfill external metadata :"
    );
    console.error(error);

    process.exit(1);
});