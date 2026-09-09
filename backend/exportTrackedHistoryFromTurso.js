require("dotenv").config();

const fs = require("fs");
const path = require("path");

const db = require("./turso");

const OUTPUT = path.join(
    __dirname,
    "..",
    "frontend",
    "data",
    "tracked-price-history.json"
);

async function main() {
    console.log(
        "Reconstruction de tracked-price-history.json depuis Turso..."
    );

    const result = await db.execute(`
        SELECT snapshot_json
        FROM tracked_price_history
        WHERE snapshot_json IS NOT NULL
        ORDER BY
            date,
            tracked_id
    `);

    const history = [];

    for (const row of result.rows) {
        if (!row.snapshot_json) {
            continue;
        }

        try {
            history.push(
                JSON.parse(
                    String(row.snapshot_json)
                )
            );
        } catch (error) {
            throw new Error(
                `snapshot_json invalide dans tracked_price_history : ${error.message}`
            );
        }
    }

    history.sort((a, b) => {
        const dateCompare =
            String(a.date)
                .localeCompare(
                    String(b.date)
                );

        if (dateCompare !== 0) {
            return dateCompare;
        }

        return (
            `${a.nomCarte}|${a.edition}|${a.langue}`
                .localeCompare(
                    `${b.nomCarte}|${b.edition}|${b.langue}`
                )
        );
    });

    fs.mkdirSync(
        path.dirname(OUTPUT),
        {
            recursive: true
        }
    );

    fs.writeFileSync(
        OUTPUT,
        JSON.stringify(
            history,
            null,
            2
        ),
        "utf8"
    );

    console.log(
        `Historique tracked reconstruit : ${history.length} ligne(s)`
    );

    console.log(
        `Fichier : ${OUTPUT}`
    );
}

main().catch(error => {
    console.error(error);
    process.exit(1);
});