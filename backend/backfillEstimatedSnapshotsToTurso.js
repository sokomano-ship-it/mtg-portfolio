require("dotenv").config();

const fs = require("fs");
const path = require("path");
const db = require("./turso");

const HISTORY_FILE = path.join(
    __dirname,
    "..",
    "frontend",
    "data",
    "estimated-price-history.json"
);

const BATCH_SIZE = 100;

async function main() {

    console.log("======================================");
    console.log("BACKFILL SNAPSHOTS COMPLETS VERS TURSO");
    console.log("======================================");

    if (!fs.existsSync(HISTORY_FILE)) {
        throw new Error(
            `Fichier introuvable : ${HISTORY_FILE}`
        );
    }

    const history = JSON.parse(
        fs.readFileSync(HISTORY_FILE, "utf8")
    );

    if (!Array.isArray(history)) {
        throw new Error(
            "estimated-price-history.json n'est pas un tableau."
        );
    }

    console.log("");
    console.log(
        `${history.length} snapshots trouvés dans le JSON.`
    );

    const statements = [];

    for (const row of history) {

        if (
            row.cardId === null ||
            row.cardId === undefined ||
            !row.date
        ) {
            continue;
        }

        statements.push({
            sql: `
                UPDATE estimated_price_history

                SET snapshot_json = ?

                WHERE card_id = ?
                  AND date = ?
            `,

            args: [
                JSON.stringify(row),
                String(row.cardId),
                String(row.date)
            ]
        });
    }

    console.log(
        `${statements.length} snapshots à sauvegarder dans Turso.`
    );

    console.log("");

    for (
        let i = 0;
        i < statements.length;
        i += BATCH_SIZE
    ) {

        const chunk = statements.slice(
            i,
            i + BATCH_SIZE
        );

        await db.batch(
            chunk,
            "write"
        );

        const done = Math.min(
            i + BATCH_SIZE,
            statements.length
        );

        if (
            done % 1000 === 0 ||
            done === statements.length
        ) {
            console.log(
                `Snapshots : ${done}/${statements.length}`
            );
        }
    }

    console.log("");
    console.log("Validation...");

    const totalResult = await db.execute(`
        SELECT COUNT(*) AS count
        FROM estimated_price_history
    `);

    const snapshotResult = await db.execute(`
        SELECT COUNT(*) AS count
        FROM estimated_price_history
        WHERE snapshot_json IS NOT NULL
          AND snapshot_json <> ''
    `);

    const totalRows =
        Number(totalResult.rows[0]?.count || 0);

    const snapshotRows =
        Number(snapshotResult.rows[0]?.count || 0);

    console.log("");
    console.log(
        `Lignes Turso       : ${totalRows}`
    );

    console.log(
        `Snapshots complets : ${snapshotRows}`
    );

    console.log(
        `Source JSON        : ${statements.length}`
    );

    console.log("");

    if (
        totalRows !== statements.length ||
        snapshotRows !== statements.length
    ) {

        throw new Error(
            "Validation incorrecte : tous les snapshots n'ont pas été sauvegardés."
        );
    }

    console.log(
        "✅ Les snapshots complets sont maintenant sauvegardés dans Turso."
    );

    console.log(
        "✅ estimated-price-history.json peut ensuite être compacté sans perte d'information."
    );
}

main()
    .then(() => {
        console.log("");
        console.log("Backfill terminé.");
        process.exit(0);
    })
    .catch(error => {
        console.error("");
        console.error("❌ Erreur :");
        console.error(
            error.message || error
        );
        process.exit(1);
    });