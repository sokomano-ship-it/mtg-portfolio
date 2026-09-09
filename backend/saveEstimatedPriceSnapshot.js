const fs = require("fs");
const path = require("path");

const db = require("./turso");

const SIMULATION_PATH = path.join(
    __dirname,
    "data",
    "pricingSimulation.json"
);

const OUTPUT_PATH = path.join(
    __dirname,
    "..",
    "frontend",
    "data",
    "estimated-price-history.json"
);

const TURSO_BATCH_SIZE = 100;


/* ============================================================
 * Helpers
 * ============================================================ */

function readJson(file, fallback) {

    if (!fs.existsSync(file)) {
        return fallback;
    }

    return JSON.parse(
        fs.readFileSync(file, "utf8")
    );
}


function normalizeEstimatedByCondition(value) {

    if (!value) {
        return null;
    }

    if (typeof value === "string") {

        try {
            return JSON.parse(value);
        } catch {
            return null;
        }
    }

    if (typeof value === "object") {
        return value;
    }

    return null;
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


function compactHistoryRow(row) {

    return {
        date:
            String(row.date || "")
                .slice(0, 10),

        cardId:
            row.cardId,

        estimatedPrice:
            Number(row.estimatedPrice || 0),

        estimatedByCondition:
            normalizeEstimatedByCondition(
                row.estimatedByCondition
            )
    };
}


/* ============================================================
 * Build full Turso snapshot
 * ============================================================ */

function buildFullSnapshot(card, today) {

    /*
     * On conserve TOUT le résultat actuel de
     * pricingSimulation.json.
     *
     * Cela permet de reconstruire dans le futur
     * les diagnostics historiques même si de
     * nouvelles propriétés sont ajoutées au moteur.
     */
    return {
        ...card,

        date: today,

        cardId:
            card.id
    };
}


/* ============================================================
 * Save full snapshots to Turso
 * ============================================================ */

async function saveSnapshotsToTurso(
    simulation,
    today
) {

    const statements = simulation.map(card => {

        const estimatedByCondition =
            normalizeEstimatedByCondition(
                card.estimatedByCondition
            ) || {};

        const fullSnapshot =
            buildFullSnapshot(
                card,
                today
            );

        return {
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
                    reference_market_anchor_price,

                    snapshot_json
                )
                VALUES (
                    ?, ?, ?, ?,
                    ?, ?, ?, ?, ?, ?,
                    ?, ?,
                    ?, ?,
                    ?
                )

                ON CONFLICT(card_id, date)
                DO UPDATE SET
                    condition =
                        excluded.condition,

                    estimated_price =
                        excluded.estimated_price,

                    price_nm =
                        excluded.price_nm,

                    price_ex =
                        excluded.price_ex,

                    price_gd =
                        excluded.price_gd,

                    price_lp =
                        excluded.price_lp,

                    price_pl =
                        excluded.price_pl,

                    price_po =
                        excluded.price_po,

                    confidence =
                        excluded.confidence,

                    pricing_model =
                        excluded.pricing_model,

                    market_anchor_price =
                        excluded.market_anchor_price,

                    reference_market_anchor_price =
                        excluded.reference_market_anchor_price,

                    snapshot_json =
                        excluded.snapshot_json
            `,

            args: [
                String(card.id),

                today,

                card.etat || null,

                numberOrNull(
                    card.estimatedPrice
                ),

                numberOrNull(
                    estimatedByCondition.NM
                ),

                numberOrNull(
                    estimatedByCondition.EX
                ),

                numberOrNull(
                    estimatedByCondition.GD
                ),

                numberOrNull(
                    estimatedByCondition.LP
                ),

                numberOrNull(
                    estimatedByCondition.PL
                ),

                numberOrNull(
                    estimatedByCondition.PO
                ),

                numberOrNull(
                    card.gradeModelConfidence ??
                    card.pricingConfidence ??
                    card.confidence
                ),

                card.pricingModel ||
                null,

                numberOrNull(
                    card.marketAnchorPrice
                ),

                numberOrNull(
                    card.referenceMarketAnchorPrice
                ),

                JSON.stringify(
                    fullSnapshot
                )
            ]
        };
    });


    let written = 0;

    for (
        let i = 0;
        i < statements.length;
        i += TURSO_BATCH_SIZE
    ) {

        const batch =
            statements.slice(
                i,
                i + TURSO_BATCH_SIZE
            );

        await db.batch(
            batch,
            "write"
        );

        written +=
            batch.length;
    }


    console.log(
        `Turso estimated snapshots : ${written} ligne(s) sauvegardée(s) pour ${today}`
    );
}


/* ============================================================
 * Save compact frontend history
 * ============================================================ */

function saveCompactFrontendHistory(
    simulation,
    today
) {

    /*
     * L'ancien fichier peut encore contenir
     * d'anciens snapshots riches.
     *
     * On les convertit systématiquement
     * vers le format frontend compact.
     */
    const previousHistory =
        readJson(
            OUTPUT_PATH,
            []
        )
        .map(
            compactHistoryRow
        )
        .filter(row =>
            row.date &&
            row.cardId !== null &&
            row.cardId !== undefined
        );


    const newRows =
        simulation.map(card => ({

            date:
                today,

            cardId:
                card.id,

            estimatedPrice:
                Number(
                    card.estimatedPrice || 0
                ),

            estimatedByCondition:
                normalizeEstimatedByCondition(
                    card.estimatedByCondition
                )
        }));


    /*
     * Une carte + une date = une seule ligne.
     *
     * Une nouvelle simulation de la même journée
     * remplace donc proprement la précédente.
     */
    const mergedByKey =
        new Map();


    previousHistory.forEach(row => {

        const key =
            `${row.date}|${String(row.cardId)}`;

        mergedByKey.set(
            key,
            row
        );
    });


    newRows.forEach(row => {

        const key =
            `${row.date}|${String(row.cardId)}`;

        mergedByKey.set(
            key,
            row
        );
    });


    const merged =
        [...mergedByKey.values()];


    merged.sort((a, b) => {

        const cardCompare =
            String(a.cardId)
                .localeCompare(
                    String(b.cardId),
                    undefined,
                    {
                        numeric: true
                    }
                );

        if (cardCompare !== 0) {
            return cardCompare;
        }

        return String(a.date)
            .localeCompare(
                String(b.date)
            );
    });


    fs.mkdirSync(
        path.dirname(
            OUTPUT_PATH
        ),
        {
            recursive: true
        }
    );


    /*
     * Minifié volontairement :
     * ce fichier est seulement un cache frontend.
     */
    fs.writeFileSync(
        OUTPUT_PATH,
        JSON.stringify(
            merged
        ),
        "utf8"
    );


    console.log(
        `Historique estimé frontend : ${merged.length} ligne(s)`
    );
}


/* ============================================================
 * Main
 * ============================================================ */

async function main() {

    const simulation =
        readJson(
            SIMULATION_PATH,
            []
        );


    if (
        !Array.isArray(simulation) ||
        simulation.length === 0
    ) {
        throw new Error(
            "pricingSimulation.json est vide ou invalide."
        );
    }


    const today =
        new Date()
            .toISOString()
            .slice(0, 10);


    console.log(
        `Snapshot estimé : ${simulation.length} carte(s) pour ${today}`
    );


    /*
     * IMPORTANT :
     *
     * 1. sauvegarde durable complète dans Turso
     * 2. seulement ensuite mise à jour du cache frontend
     *
     * Si Turso échoue, le script échoue ici et
     * le JSON frontend n'est pas modifié.
     */
    await saveSnapshotsToTurso(
        simulation,
        today
    );


    saveCompactFrontendHistory(
        simulation,
        today
    );


    console.log(
        "✅ Snapshot estimé sauvegardé dans Turso et frontend."
    );
}


main().catch(error => {

    console.error(
        "❌ Erreur saveEstimatedPriceSnapshot :",
        error
    );

    process.exit(1);
});