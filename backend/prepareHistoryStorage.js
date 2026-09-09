require("dotenv").config();

const db = require("./turso");

async function main() {
    console.log("Préparation des tables historiques Turso...");

    await db.execute(`
        CREATE TABLE IF NOT EXISTS estimated_price_history (
            card_id INTEGER NOT NULL,
            date TEXT NOT NULL,
            condition TEXT,
            estimated_price REAL,

            price_nm REAL,
            price_ex REAL,
            price_gd REAL,
            price_lp REAL,
            price_pl REAL,
            price_po REAL,

            confidence REAL,
            pricing_model TEXT,

            market_anchor_price REAL,
            reference_market_anchor_price REAL,

            PRIMARY KEY (card_id, date)
        )
    `);

        const estimatedColumnsResult = await db.execute(`
        PRAGMA table_info(estimated_price_history)
    `);

    const estimatedColumns = new Set(
        estimatedColumnsResult.rows.map(row => String(row.name))
    );

    if (!estimatedColumns.has("snapshot_json")) {
        console.log("Ajout colonne estimated_price_history.snapshot_json...");

        await db.execute(`
            ALTER TABLE estimated_price_history
            ADD COLUMN snapshot_json TEXT
        `);
    }

    await db.execute(`
        CREATE INDEX IF NOT EXISTS idx_estimated_price_history_date
        ON estimated_price_history(date)
    `);

    await db.execute(`
        CREATE TABLE IF NOT EXISTS tracked_price_history (
            tracked_id TEXT NOT NULL,
            date TEXT NOT NULL,

            price_nm REAL,
            price_ex REAL,
            price_gd REAL,
            price_lp REAL,
            price_pl REAL,
            price_po REAL,

            trend_price REAL,
            avg_1 REAL,
            avg_7 REAL,
            avg_30 REAL,

            confidence REAL,
            grade_model_source TEXT,
            snapshot_json TEXT,

            PRIMARY KEY (tracked_id, date)
        )
    `);
        // Migration de schéma pour les tables déjà créées
    const trackedColumnsResult = await db.execute(`
        PRAGMA table_info(tracked_price_history)
    `);

    const trackedColumns = new Set(
        trackedColumnsResult.rows.map(row => String(row.name))
    );

    if (!trackedColumns.has("grade_model_source")) {
        console.log("Ajout colonne tracked_price_history.grade_model_source...");

        await db.execute(`
            ALTER TABLE tracked_price_history
            ADD COLUMN grade_model_source TEXT
        `);
    }
    if (!trackedColumns.has("snapshot_json")) {
    console.log(
        "Ajout colonne tracked_price_history.snapshot_json..."
    );

    await db.execute(`
        ALTER TABLE tracked_price_history
        ADD COLUMN snapshot_json TEXT
    `);
}

    await db.execute(`
        CREATE INDEX IF NOT EXISTS idx_tracked_price_history_date
        ON tracked_price_history(date)
    `);

    /*
     * Métadonnées propres à chaque impression du radar externe.
     *
     * On les sépare de l'historique journalier afin de ne pas
     * répéter nom / édition / langue / mapping tous les jours.
     */
    await db.execute(`
        CREATE TABLE IF NOT EXISTS external_market_cards (
            card_key TEXT PRIMARY KEY,

            nom_carte TEXT,
            edition TEXT,
            langue TEXT,

            mapping_json TEXT,
            cardmarket_current_json TEXT
        )
    `);

    await db.execute(`
        CREATE TABLE IF NOT EXISTS external_market_history (
            card_key TEXT NOT NULL,
            source TEXT NOT NULL,
            date TEXT NOT NULL,
            price REAL,

            PRIMARY KEY (card_key, source, date)
        )
    `);

    await db.execute(`
        CREATE INDEX IF NOT EXISTS idx_external_market_history_date
        ON external_market_history(date)
    `);

    await db.execute(`
        CREATE INDEX IF NOT EXISTS idx_external_market_history_card
        ON external_market_history(card_key)
    `);

    /*
     * Métadonnées globales :
     * - taux USD/EUR
     * - statut des backfills
     * - version
     * - date de mise à jour
     * etc.
     */
    await db.execute(`
        CREATE TABLE IF NOT EXISTS storage_metadata (
            key TEXT PRIMARY KEY,
            value TEXT,
            updated_at TEXT DEFAULT CURRENT_TIMESTAMP
        )
    `);

    console.log("");
    console.log("✅ Tables Turso créées/vérifiées :");
    console.log("   estimated_price_history");
    console.log("   tracked_price_history");
    console.log("   external_market_cards");
    console.log("   external_market_history");
    console.log("   storage_metadata");

    console.log("");
    console.log("✅ Préparation Turso terminée.");
}

main().catch(error => {
    console.error("");
    console.error("❌ Erreur Turso :");
    console.error(error);
    process.exit(1);
});