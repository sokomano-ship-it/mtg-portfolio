require("dotenv").config();

const fs = require("fs");
const path = require("path");

const turso = require("./turso");

const ROOT = path.join(
    __dirname,
    ".."
);

const OUTPUT_PATH = path.join(
    ROOT,
    "frontend",
    "data",
    "price-history-snapshots.json"
);

async function main() {

    console.log(
        "Reconstruction price-history-snapshots.json depuis Turso..."
    );

    const result =
        await turso.execute(`
            SELECT
                snapshot_json
            FROM price_history_snapshots
            WHERE snapshot_json IS NOT NULL
            ORDER BY
                date,
                nom_carte,
                edition,
                version,
                langue,
                cardmarket_id
        `);

    const history = [];

    for (const row of result.rows) {

        if (!row.snapshot_json) {
            continue;
        }

        history.push(
            JSON.parse(
                String(
                    row.snapshot_json
                )
            )
        );
    }

    fs.mkdirSync(
        path.dirname(
            OUTPUT_PATH
        ),
        {
            recursive: true
        }
    );

    fs.writeFileSync(
        OUTPUT_PATH,
        JSON.stringify(
            history,
            null,
            2
        ),
        "utf8"
    );

    const dates =
        history
            .map(row => row.date)
            .filter(Boolean)
            .sort();

    console.log(
        `Snapshots reconstruits : ${history.length}`
    );

    console.log(
        `Première date : ${
            dates.length
                ? dates[0]
                : null
        }`
    );

    console.log(
        `Dernière date : ${
            dates.length
                ? dates[
                    dates.length - 1
                ]
                : null
        }`
    );

    console.log(
        `Fichier : ${OUTPUT_PATH}`
    );

    console.log("");
    console.log(
        "✅ price-history-snapshots.json reconstruit depuis Turso."
    );
}

main().catch(error => {

    console.error("");
    console.error(
        "❌ Erreur reconstruction price history :"
    );

    console.error(error);

    process.exit(1);
});