require("dotenv").config();

const fs = require("fs");
const path = require("path");

const db = require("./turso");

const ROOT = path.join(__dirname, "..");

const OUTPUT_PATH = path.join(
    ROOT,
    "frontend",
    "data",
    "external-market-history.json"
);


function parseMetadata(
    metadata,
    key,
    fallback
) {

    const raw =
        metadata.get(key);

    if (
        raw === undefined ||
        raw === null
    ) {
        return fallback;
    }

    try {
        return JSON.parse(raw);
    } catch {
        return raw;
    }
}


async function main() {

    console.log(
        "Reconstruction external-market-history.json depuis Turso..."
    );


    const history = {
        version: 1,
        cards: {},
        tcgBackfillCompleted: false,
        updatedAt: null,
        usdEur: null,
        cardmarketMetric: null,
        cardmarketTrendBackfillCompleted: false
    };


    /*
     * ========================================================
     * CARTES / IMPRESSIONS
     * ========================================================
     */

    const cardsResult =
        await db.execute(`
            SELECT
                card_key,
                nom_carte,
                edition,
                langue,
                mapping_json,
                cardmarket_current_json
            FROM external_market_cards
            ORDER BY card_key
        `);


    for (const row of cardsResult.rows) {

        history.cards[
            String(row.card_key)
        ] = {

            nomCarte:
                row.nom_carte ?? null,

            edition:
                row.edition ?? null,

            langue:
                row.langue ?? null,

            mapping:
                row.mapping_json
                    ? JSON.parse(
                        row.mapping_json
                    )
                    : null,

            cardmarketCurrent:
                row.cardmarket_current_json
                    ? JSON.parse(
                        row.cardmarket_current_json
                    )
                    : null,

            tcg: [],

            cardmarket: []
        };
    }


    /*
     * ========================================================
     * HISTORIQUE PRIX
     * ========================================================
     */

    const pricesResult =
        await db.execute(`
            SELECT
                card_key,
                source,
                date,
                price
            FROM external_market_history
            ORDER BY
                card_key,
                source,
                date
        `);


    let tcgCount = 0;
    let cardmarketCount = 0;


    for (const row of pricesResult.rows) {

        const cardKey =
            String(row.card_key);


        if (!history.cards[cardKey]) {

            history.cards[cardKey] = {
                nomCarte: null,
                edition: null,
                langue: null,
                mapping: null,
                cardmarketCurrent: null,
                tcg: [],
                cardmarket: []
            };
        }


        const point = {
            date:
                String(row.date),

            price:
                Number(row.price)
        };


        if (row.source === "tcg") {

            history.cards[
                cardKey
            ].tcg.push(
                point
            );

            tcgCount += 1;

        } else if (
            row.source === "cardmarket"
        ) {

            history.cards[
                cardKey
            ].cardmarket.push(
                point
            );

            cardmarketCount += 1;
        }
    }


    /*
     * ========================================================
     * METADONNEES
     * ========================================================
     */

    const metadataResult =
        await db.execute(`
            SELECT
                key,
                value
            FROM storage_metadata
            WHERE key LIKE 'external_market.%'
        `);


    const metadata =
        new Map(
            metadataResult.rows.map(
                row => [
                    String(row.key),
                    row.value
                ]
            )
        );


    history.version =
        parseMetadata(
            metadata,
            "external_market.version",
            1
        );

    history.tcgBackfillCompleted =
        parseMetadata(
            metadata,
            "external_market.tcgBackfillCompleted",
            false
        );

    history.updatedAt =
        parseMetadata(
            metadata,
            "external_market.updatedAt",
            null
        );

    history.usdEur =
        parseMetadata(
            metadata,
            "external_market.usdEur",
            null
        );

    history.cardmarketMetric =
        parseMetadata(
            metadata,
            "external_market.cardmarketMetric",
            null
        );

    history.cardmarketTrendBackfillCompleted =
        parseMetadata(
            metadata,
            "external_market.cardmarketTrendBackfillCompleted",
            false
        );


    /*
     * ========================================================
     * EXPORT
     * ========================================================
     */

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


    console.log(
        `Cartes : ${Object.keys(history.cards).length}`
    );

    console.log(
        `TCG : ${tcgCount}`
    );

    console.log(
        `Cardmarket : ${cardmarketCount}`
    );

    console.log(
        `Total points : ${tcgCount + cardmarketCount}`
    );

    console.log(
        `Fichier : ${OUTPUT_PATH}`
    );

    console.log("");
    console.log(
        "✅ external-market-history.json reconstruit depuis Turso."
    );
}


main().catch(error => {

    console.error("");
    console.error(
        "❌ Erreur reconstruction external market :"
    );
    console.error(error);

    process.exit(1);
});