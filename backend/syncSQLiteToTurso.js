require("dotenv").config();

const path = require("path");
const crypto = require("crypto");
const sqlite3 = require("sqlite3").verbose();

const turso = require("./turso");

const DB_PATH =
    path.join(
        __dirname,
        "..",
        "database",
        "portfolio.db"
    );

const db =
    new sqlite3.Database(
        DB_PATH,
        sqlite3.OPEN_READONLY
    );


function all(sql, params = []) {

    return new Promise(
        (resolve, reject) => {

            db.all(
                sql,
                params,
                (error, rows) => {

                    if (error) {
                        reject(error);
                        return;
                    }

                    resolve(rows);
                }
            );
        }
    );
}


function closeDb() {

    return new Promise(
        (resolve, reject) => {

            db.close(error => {

                if (error) {
                    reject(error);
                    return;
                }

                resolve();
            });
        }
    );
}


function makeGenerationId() {

    return (
        new Date()
            .toISOString()
            .replace(
                /[-:.TZ]/g,
                ""
            ) +
        "-" +
        crypto
            .randomBytes(4)
            .toString("hex")
    );
}


function makeRowKey(
    row,
    pkColumns
) {

    if (pkColumns.length) {

        return JSON.stringify(
            pkColumns.map(
                column =>
                    row[column]
            )
        );
    }

    return JSON.stringify([
        "__rowid__",
        row.__mirror_rowid
    ]);
}


async function writeBatch(
    statements,
    chunkSize = 100
) {

    for (
        let index = 0;
        index < statements.length;
        index += chunkSize
    ) {

        const chunk =
            statements.slice(
                index,
                index + chunkSize
            );

        await turso.batch(
            chunk,
            "write"
        );
    }
}


async function main() {

    const generationId =
        makeGenerationId();

    console.log(
        `Génération miroir : ${generationId}`
    );

    const schemaObjects =
        await all(`
            SELECT
                type,
                name,
                tbl_name AS tableName,
                sql
            FROM sqlite_master
            WHERE
                type IN (
                    'table',
                    'index',
                    'trigger',
                    'view'
                )
                AND name NOT LIKE 'sqlite_%'
                AND sql IS NOT NULL
            ORDER BY
                CASE type
                    WHEN 'table' THEN 1
                    WHEN 'index' THEN 2
                    WHEN 'trigger' THEN 3
                    WHEN 'view' THEN 4
                    ELSE 5
                END,
                name
        `);

    const tables =
        schemaObjects.filter(
            object =>
                object.type ===
                "table"
        );

    const schemaStatements = [];

    const tableInfo =
        new Map();

    for (const table of tables) {

        const columns =
            await all(
                `PRAGMA table_info("${table.name.replace(/"/g, '""')}")`
            );

        const pkColumns =
            columns
                .filter(
                    column =>
                        Number(
                            column.pk
                        ) > 0
                )
                .sort(
                    (a, b) =>
                        Number(a.pk) -
                        Number(b.pk)
                )
                .map(
                    column =>
                        column.name
                );

        tableInfo.set(
            table.name,
            {
                pkColumns
            }
        );
    }

    for (
        const object of
        schemaObjects
    ) {

        const pkColumns =
            object.type === "table"
                ? (
                    tableInfo.get(
                        object.name
                    )?.pkColumns ||
                    []
                )
                : [];

        schemaStatements.push({
            sql: `
                INSERT INTO portfolio_mirror_schema (
                    generation_id,
                    object_type,
                    object_name,
                    table_name,
                    sql,
                    pk_columns_json
                )
                VALUES (?, ?, ?, ?, ?, ?)
            `,
            args: [
                generationId,
                object.type,
                object.name,
                object.tableName,
                object.sql,
                JSON.stringify(
                    pkColumns
                )
            ]
        });
    }

    await writeBatch(
        schemaStatements
    );

    console.log(
        `Schéma : ${schemaObjects.length} objet(s)`
    );

    let totalRows = 0;

    const counts = {};

    for (const table of tables) {

        const escaped =
            table.name.replace(
                /"/g,
                '""'
            );

        const rows =
            await all(
                `
                SELECT
                    rowid AS __mirror_rowid,
                    *
                FROM "${escaped}"
                `
            );

        const pkColumns =
            tableInfo.get(
                table.name
            )?.pkColumns || [];

        const statements =
            rows.map(row => {

                const rowid =
                    row.__mirror_rowid;

                const storedRow = {
                    ...row
                };

                delete storedRow
                    .__mirror_rowid;

                return {
                    sql: `
                        INSERT INTO portfolio_mirror_rows (
                            generation_id,
                            table_name,
                            row_key,
                            rowid_value,
                            row_json
                        )
                        VALUES (?, ?, ?, ?, ?)
                    `,
                    args: [
                        generationId,
                        table.name,
                        makeRowKey(
                            row,
                            pkColumns
                        ),
                        rowid,
                        JSON.stringify(
                            storedRow
                        )
                    ]
                };
            });

        await writeBatch(
            statements
        );

        counts[table.name] =
            rows.length;

        totalRows +=
            rows.length;

        console.log(
            `${table.name} : ${rows.length}`
        );
    }

    /*
     * On ne bascule le pointeur qu'une fois
     * la génération entièrement sauvegardée.
     */
    await turso.execute({
        sql: `
            INSERT INTO portfolio_mirror_metadata (
                key,
                value,
                updated_at
            )
            VALUES (
                'current_generation',
                ?,
                CURRENT_TIMESTAMP
            )
            ON CONFLICT(key)
            DO UPDATE SET
                value = excluded.value,
                updated_at = CURRENT_TIMESTAMP
        `,
        args: [
            generationId
        ]
    });

    await turso.execute({
        sql: `
            INSERT INTO portfolio_mirror_metadata (
                key,
                value,
                updated_at
            )
            VALUES (
                'current_counts',
                ?,
                CURRENT_TIMESTAMP
            )
            ON CONFLICT(key)
            DO UPDATE SET
                value = excluded.value,
                updated_at = CURRENT_TIMESTAMP
        `,
        args: [
            JSON.stringify(
                counts
            )
        ]
    });

    console.log("");
    console.log(
        `Total : ${totalRows} ligne(s)`
    );

    console.log(
        `✅ SQLite sauvegardé dans Turso : ${generationId}`
    );

        /*
     * La nouvelle génération est maintenant active.
     * Les anciennes générations ne sont plus nécessaires.
     *
     * Important :
     * le nettoyage intervient seulement APRÈS
     * le basculement de current_generation.
     */
    try {

        const oldRows =
            await turso.execute({
                sql: `
                    DELETE FROM portfolio_mirror_rows
                    WHERE generation_id <> ?
                `,
                args: [
                    generationId
                ]
            });

        const oldSchema =
            await turso.execute({
                sql: `
                    DELETE FROM portfolio_mirror_schema
                    WHERE generation_id <> ?
                `,
                args: [
                    generationId
                ]
            });

        console.log(
            "Anciennes générations Turso nettoyées."
        );

    } catch (cleanupError) {

        /*
         * Une erreur de nettoyage ne doit pas invalider
         * une génération qui a déjà été entièrement
         * sauvegardée et activée.
         */
        console.warn(
            "⚠️ Génération sauvegardée, mais nettoyage Turso incomplet :",
            cleanupError.message
        );
    }

    await closeDb();
}


main().catch(async error => {

    console.error("");
    console.error(
        "❌ Synchronisation SQLite → Turso impossible :"
    );

    console.error(error);

    try {
        await closeDb();
    } catch {
        // rien
    }

    process.exit(1);
});
