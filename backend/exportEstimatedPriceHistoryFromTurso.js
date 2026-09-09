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
    "estimated-price-history.json"
);

async function main() {

    console.log(
        "Reconstruction estimated-price-history.json depuis Turso..."
    );

    const result =
        await turso.execute(`
            SELECT
                card_id,
                date,
                estimated_price,
                snapshot_json
            FROM estimated_price_history
            ORDER BY
                date,
                card_id
        `);

    const history = [];

    for (const row of result.rows) {

        let snapshot = null;

        if (row.snapshot_json) {
            try {
                snapshot =
                    JSON.parse(
                        String(
                            row.snapshot_json
                        )
                    );
            } catch {
                snapshot = null;
            }
        }

        history.push({
            date:
                String(
                    row.date
                ),

            cardId:
    /^-?\d+$/.test(
        String(row.card_id)
    )
        ? Number(row.card_id)
        : String(row.card_id),

            estimatedPrice:
                row.estimated_price === null ||
                row.estimated_price === undefined
                    ? null
                    : Number(
                        row.estimated_price
                    ),

            estimatedByCondition:
                snapshot?.estimatedByCondition ??
                null
        });
    }

    fs.mkdirSync(
        path.dirname(
            OUTPUT_PATH
        ),
        {
            recursive: true
        }
    );

    /*
     * On conserve volontairement le format compact :
     * ce fichier est un cache frontend,
     * pas le stockage historique canonique.
     */
    fs.writeFileSync(
        OUTPUT_PATH,
        JSON.stringify(
            history
        ),
        "utf8"
    );

    const dates =
        history
            .map(row => row.date)
            .filter(Boolean)
            .sort();

    const withConditions =
        history.filter(
            row =>
                row.estimatedByCondition &&
                typeof row.estimatedByCondition === "object"
        ).length;

    console.log(
        `Lignes reconstruites : ${history.length}`
    );

    console.log(
        `Avec estimatedByCondition : ${withConditions}`
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
        "✅ estimated-price-history.json reconstruit depuis Turso."
    );
}

main().catch(error => {

    console.error("");
    console.error(
        "❌ Erreur reconstruction estimated history :"
    );

    console.error(error);

    process.exit(1);
});