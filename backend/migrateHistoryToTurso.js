require("dotenv").config();

const fs = require("fs");
const path = require("path");
const db = require("./turso");

const ROOT = path.join(__dirname, "..");

const ESTIMATED_HISTORY_PATH = path.join(
    ROOT,
    "frontend",
    "data",
    "estimated-price-history.json"
);

const TRACKED_HISTORY_PATH = path.join(
    ROOT,
    "frontend",
    "data",
    "tracked-price-history.json"
);

const EXTERNAL_HISTORY_PATH = path.join(
    ROOT,
    "frontend",
    "data",
    "external-market-history.json"
);

const BATCH_SIZE = 100;


/*
 * ============================================================
 * UTILITAIRES
 * ============================================================
 */

function readJson(file) {
    if (!fs.existsSync(file)) {
        throw new Error(
            `Fichier introuvable : ${file}`
        );
    }

    return JSON.parse(
        fs.readFileSync(file, "utf8")
    );
}


function nullableNumber(value) {
    if (
        value === null ||
        value === undefined ||
        value === ""
    ) {
        return null;
    }

    const number = Number(value);

    return Number.isFinite(number)
        ? number
        : null;
}


function jsonOrNull(value) {
    if (
        value === undefined ||
        value === null
    ) {
        return null;
    }

    return JSON.stringify(value);
}


async function runBatch(
    statements,
    label
) {
    if (!statements.length) {
        return;
    }

    for (
        let i = 0;
        i < statements.length;
        i += BATCH_SIZE
    ) {
        const chunk =
            statements.slice(
                i,
                i + BATCH_SIZE
            );

        await db.batch(
            chunk,
            "write"
        );

        const done =
            Math.min(
                i + BATCH_SIZE,
                statements.length
            );

        if (
            done === statements.length ||
            done % 1000 === 0
        ) {
            console.log(
                `   ${label}: ${done}/${statements.length}`
            );
        }
    }
}


async function scalar(sql) {
    const result =
        await db.execute(sql);

    const value =
        result.rows?.[0]?.count;

    return Number(value || 0);
}


/*
 * ============================================================
 * ESTIMATED PRICE HISTORY
 * ============================================================
 */

async function migrateEstimatedHistory() {
    console.log("");
    console.log(
        "1/3 Migration estimated-price-history.json..."
    );

    const history =
        readJson(
            ESTIMATED_HISTORY_PATH
        );

    if (!Array.isArray(history)) {
        throw new Error(
            "estimated-price-history.json n'est pas un tableau."
        );
    }

    const statements = [];

    for (const row of history) {
        if (
            row.cardId === null ||
            row.cardId === undefined ||
            !row.date
        ) {
            continue;
        }

        const condition =
            row.etat
                ? String(row.etat)
                : null;

        const estimated =
            row.estimatedByCondition || {};

        statements.push({
            sql: `
                INSERT INTO estimated_price_history (
                    card_id,
                    date,
                    condition,
                    estimated_price,

                    price_nm,
                    price_ex,
                    price_gd,
                    price_lp,
                    price_pl,
                    price_po,

                    confidence,
                    pricing_model,

                    market_anchor_price,
                    reference_market_anchor_price
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)

                ON CONFLICT(card_id, date)
                DO UPDATE SET
                    condition = excluded.condition,
                    estimated_price = excluded.estimated_price,

                    price_nm = excluded.price_nm,
                    price_ex = excluded.price_ex,
                    price_gd = excluded.price_gd,
                    price_lp = excluded.price_lp,
                    price_pl = excluded.price_pl,
                    price_po = excluded.price_po,

                    confidence = excluded.confidence,
                    pricing_model = excluded.pricing_model,

                    market_anchor_price =
                        excluded.market_anchor_price,

                    reference_market_anchor_price =
                        excluded.reference_market_anchor_price
            `,
            args: [
                String(row.cardId),
                String(row.date),
                condition,

                nullableNumber(
                    row.estimatedPrice
                ),

                nullableNumber(
                    estimated.NM
                ),
                nullableNumber(
                    estimated.EX
                ),
                nullableNumber(
                    estimated.GD
                ),
                nullableNumber(
                    estimated.LP
                ),
                nullableNumber(
                    estimated.PL
                ),
                nullableNumber(
                    estimated.PO
                ),

                nullableNumber(
                    row.gradeModelConfidence ??
                    row.confidence
                ),

                row.pricingModel
                    ? String(row.pricingModel)
                    : null,

                nullableNumber(
                    row.marketAnchorPrice
                ),

                nullableNumber(
                    row.referenceMarketAnchorPrice
                )
            ]
        });
    }

    await runBatch(
        statements,
        "Estimated"
    );

    return {
        sourceRows:
            history.length,

        migratedRows:
            statements.length
    };
}


/*
 * ============================================================
 * TRACKED PRICE HISTORY
 * ============================================================
 */

async function migrateTrackedHistory() {
    console.log("");
    console.log(
        "2/3 Migration tracked-price-history.json..."
    );

    const history =
        readJson(
            TRACKED_HISTORY_PATH
        );

    if (!Array.isArray(history)) {
        throw new Error(
            "tracked-price-history.json n'est pas un tableau."
        );
    }

    const statements = [];

    for (const row of history) {
        if (
            row.trackedId === null ||
            row.trackedId === undefined ||
            !row.date
        ) {
            continue;
        }

        const estimated =
            row.estimatedByCondition || {};

        statements.push({
            sql: `
                INSERT INTO tracked_price_history (
                    tracked_id,
                    date,

                    price_nm,
                    price_ex,
                    price_gd,
                    price_lp,
                    price_pl,
                    price_po,

                    trend_price,
                    avg_1,
                    avg_7,
                    avg_30,

                    confidence,
                    grade_model_source
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)

                ON CONFLICT(tracked_id, date)
                DO UPDATE SET
                    price_nm = excluded.price_nm,
                    price_ex = excluded.price_ex,
                    price_gd = excluded.price_gd,
                    price_lp = excluded.price_lp,
                    price_pl = excluded.price_pl,
                    price_po = excluded.price_po,

                    trend_price = excluded.trend_price,
                    avg_1 = excluded.avg_1,
                    avg_7 = excluded.avg_7,
                    avg_30 = excluded.avg_30,

                    confidence = excluded.confidence,
                    grade_model_source =
                        excluded.grade_model_source
            `,
            args: [
                String(row.trackedId),
                String(row.date),

                nullableNumber(
                    estimated.NM
                ),
                nullableNumber(
                    estimated.EX
                ),
                nullableNumber(
                    estimated.GD
                ),
                nullableNumber(
                    estimated.LP
                ),
                nullableNumber(
                    estimated.PL
                ),
                nullableNumber(
                    estimated.PO
                ),

                nullableNumber(
                    row.trendPrice
                ),
                nullableNumber(
                    row.avg1
                ),
                nullableNumber(
                    row.avg7
                ),
                nullableNumber(
                    row.avg30
                ),

                nullableNumber(
                    row.gradeModelConfidence
                ),

                row.gradeModelSource
                    ? String(
                        row.gradeModelSource
                    )
                    : null
            ]
        });
    }

    await runBatch(
        statements,
        "Tracked"
    );

    return {
        sourceRows:
            history.length,

        migratedRows:
            statements.length
    };
}


/*
 * ============================================================
 * EXTERNAL MARKET HISTORY
 * ============================================================
 */

async function migrateExternalHistory() {
    console.log("");
    console.log(
        "3/3 Migration external-market-history.json..."
    );

    const history =
        readJson(
            EXTERNAL_HISTORY_PATH
        );

    const cards =
        history.cards || {};

    const cardStatements = [];
    const priceStatements = [];

    for (
        const [cardKey, entry]
        of Object.entries(cards)
    ) {
        cardStatements.push({
            sql: `
                INSERT INTO external_market_cards (
                    card_key,
                    nom_carte,
                    edition,
                    langue,
                    mapping_json,
                    cardmarket_current_json
                )
                VALUES (?, ?, ?, ?, ?, ?)

                ON CONFLICT(card_key)
                DO UPDATE SET
                    nom_carte =
                        excluded.nom_carte,
                    edition =
                        excluded.edition,
                    langue =
                        excluded.langue,
                    mapping_json =
                        excluded.mapping_json,
                    cardmarket_current_json =
                        excluded.cardmarket_current_json
            `,
            args: [
                cardKey,

                entry.nomCarte ?? null,
                entry.edition ?? null,
                entry.langue ?? null,

                jsonOrNull(
                    entry.mapping
                ),

                jsonOrNull(
                    entry.cardmarketCurrent
                )
            ]
        });

        for (
            const point of
            Array.isArray(entry.tcg)
                ? entry.tcg
                : []
        ) {
            if (
                !point?.date ||
                !Number.isFinite(
                    Number(point.price)
                )
            ) {
                continue;
            }

            priceStatements.push({
                sql: `
                    INSERT INTO external_market_history (
                        card_key,
                        source,
                        date,
                        price
                    )
                    VALUES (?, 'tcg', ?, ?)

                    ON CONFLICT(
                        card_key,
                        source,
                        date
                    )
                    DO UPDATE SET
                        price = excluded.price
                `,
                args: [
                    cardKey,
                    String(point.date),
                    Number(point.price)
                ]
            });
        }

        for (
            const point of
            Array.isArray(
                entry.cardmarket
            )
                ? entry.cardmarket
                : []
        ) {
            if (
                !point?.date ||
                !Number.isFinite(
                    Number(point.price)
                )
            ) {
                continue;
            }

            priceStatements.push({
                sql: `
                    INSERT INTO external_market_history (
                        card_key,
                        source,
                        date,
                        price
                    )
                    VALUES (?, 'cardmarket', ?, ?)

                    ON CONFLICT(
                        card_key,
                        source,
                        date
                    )
                    DO UPDATE SET
                        price = excluded.price
                `,
                args: [
                    cardKey,
                    String(point.date),
                    Number(point.price)
                ]
            });
        }
    }

    await runBatch(
        cardStatements,
        "External cards"
    );

    await runBatch(
        priceStatements,
        "External prices"
    );


    /*
     * Sauvegarde des métadonnées globales.
     *
     * Tout ce qui n'est pas "cards" est conservé.
     */
    const metadataStatements =
        Object.entries(history)
            .filter(
                ([key]) =>
                    key !== "cards"
            )
            .map(
                ([key, value]) => ({
                    sql: `
                        INSERT INTO storage_metadata (
                            key,
                            value,
                            updated_at
                        )
                        VALUES (
                            ?,
                            ?,
                            CURRENT_TIMESTAMP
                        )

                        ON CONFLICT(key)
                        DO UPDATE SET
                            value = excluded.value,
                            updated_at =
                                CURRENT_TIMESTAMP
                    `,
                    args: [
                        `external_market.${key}`,
                        JSON.stringify(value)
                    ]
                })
            );

    await runBatch(
        metadataStatements,
        "Metadata"
    );

    return {
        sourceCards:
            Object.keys(cards).length,

        sourcePrices:
            priceStatements.length
    };
}


/*
 * ============================================================
 * VALIDATION
 * ============================================================
 */

async function validate(
    estimated,
    tracked,
    external
) {
    console.log("");
    console.log(
        "======================================"
    );
    console.log(
        "VALIDATION TURSO"
    );
    console.log(
        "======================================"
    );

    const estimatedCount =
        await scalar(`
            SELECT COUNT(*) AS count
            FROM estimated_price_history
        `);

    const trackedCount =
        await scalar(`
            SELECT COUNT(*) AS count
            FROM tracked_price_history
        `);

    const externalCardsCount =
        await scalar(`
            SELECT COUNT(*) AS count
            FROM external_market_cards
        `);

    const externalPricesCount =
        await scalar(`
            SELECT COUNT(*) AS count
            FROM external_market_history
        `);


    function status(
        source,
        target
    ) {
        return source === target
            ? "✅"
            : "⚠️";
    }


    console.log("");
    console.log(
        `Estimated : source=${estimated.migratedRows} Turso=${estimatedCount} ${status(
            estimated.migratedRows,
            estimatedCount
        )}`
    );

    console.log(
        `Tracked   : source=${tracked.migratedRows} Turso=${trackedCount} ${status(
            tracked.migratedRows,
            trackedCount
        )}`
    );

    console.log(
        `External cards  : source=${external.sourceCards} Turso=${externalCardsCount} ${status(
            external.sourceCards,
            externalCardsCount
        )}`
    );

    console.log(
        `External prices : source=${external.sourcePrices} Turso=${externalPricesCount} ${status(
            external.sourcePrices,
            externalPricesCount
        )}`
    );


    const ok =
        estimated.migratedRows ===
            estimatedCount &&
        tracked.migratedRows ===
            trackedCount &&
        external.sourceCards ===
            externalCardsCount &&
        external.sourcePrices ===
            externalPricesCount;


    console.log("");

    if (!ok) {
        throw new Error(
            "La validation n'est pas parfaite. Aucun fichier source n'a été modifié : on peut diagnostiquer sans perte."
        );
    }

    console.log(
        "✅ Migration validée : les historiques sont maintenant sauvegardés dans Turso."
    );
}


/*
 * ============================================================
 * MAIN
 * ============================================================
 */

async function main() {
    console.log(
        "======================================"
    );

    console.log(
        "MTG Portfolio - Migration historique"
    );

    console.log(
        "======================================"
    );

    console.log("");
    console.log(
        "Aucun fichier source ne sera modifié."
    );


    const estimated =
        await migrateEstimatedHistory();

    const tracked =
        await migrateTrackedHistory();

    const external =
        await migrateExternalHistory();


    await validate(
        estimated,
        tracked,
        external
    );
}


main()
    .then(() => {
        console.log("");
        console.log(
            "Phase 1 terminée."
        );

        process.exit(0);
    })
    .catch(error => {
        console.error("");
        console.error(
            "❌ Migration interrompue :"
        );

        console.error(
            error.message || error
        );

        process.exit(1);
    });