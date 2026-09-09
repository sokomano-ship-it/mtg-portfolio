require("dotenv").config();

const turso = require("./turso");

async function main() {

    await turso.execute(`
        CREATE TABLE IF NOT EXISTS portfolio_mirror_schema (
            generation_id TEXT NOT NULL,
            object_type TEXT NOT NULL,
            object_name TEXT NOT NULL,
            table_name TEXT,
            sql TEXT,
            pk_columns_json TEXT,
            PRIMARY KEY (
                generation_id,
                object_type,
                object_name
            )
        )
    `);

    await turso.execute(`
        CREATE TABLE IF NOT EXISTS portfolio_mirror_rows (
            generation_id TEXT NOT NULL,
            table_name TEXT NOT NULL,
            row_key TEXT NOT NULL,
            rowid_value INTEGER,
            row_json TEXT NOT NULL,
            PRIMARY KEY (
                generation_id,
                table_name,
                row_key
            )
        )
    `);

    await turso.execute(`
        CREATE INDEX IF NOT EXISTS
        idx_portfolio_mirror_rows_generation_table
        ON portfolio_mirror_rows (
            generation_id,
            table_name
        )
    `);

    await turso.execute(`
        CREATE TABLE IF NOT EXISTS portfolio_mirror_metadata (
            key TEXT PRIMARY KEY,
            value TEXT,
            updated_at TEXT DEFAULT CURRENT_TIMESTAMP
        )
    `);

    console.log("");
    console.log("✅ Stockage miroir SQLite/Turso prêt.");
    console.log("   portfolio_mirror_schema");
    console.log("   portfolio_mirror_rows");
    console.log("   portfolio_mirror_metadata");
}

main().catch(error => {

    console.error("");
    console.error("❌ Préparation Turso impossible :");
    console.error(error);

    process.exit(1);
});