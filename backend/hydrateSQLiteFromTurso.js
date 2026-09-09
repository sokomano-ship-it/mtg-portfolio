require("dotenv").config();

const fs = require("fs");
const path = require("path");
const sqlite3 = require("sqlite3").verbose();

const turso = require("./turso");

const OUTPUT_PATH =
    path.join(
        __dirname,
        "..",
        "database",
        "portfolio.from-turso.db"
    );


function run(
    db,
    sql,
    params = []
) {

    return new Promise(
        (resolve, reject) => {

            db.run(
                sql,
                params,
                error => {

                    if (error) {
                        reject(error);
                        return;
                    }

                    resolve();
                }
            );
        }
    );
}


function closeDb(db) {

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


function quoteIdentifier(value) {

    return (
        '"' +
        String(value)
            .replace(
                /"/g,
                '""'
            ) +
        '"'
    );
}


async function main() {

    const generationResult =
        await turso.execute(`
            SELECT value
            FROM portfolio_mirror_metadata
            WHERE key = 'current_generation'
        `);

    const generationId =
        generationResult.rows?.[0]
            ?.value;

    if (!generationId) {

        throw new Error(
            "Aucune génération SQLite disponible dans Turso."
        );
    }

    console.log(
        `Génération Turso : ${generationId}`
    );

    const schemaResult =
        await turso.execute({
            sql: `
                SELECT
                    object_type,
                    object_name,
                    table_name,
                    sql,
                    pk_columns_json
                FROM portfolio_mirror_schema
                WHERE generation_id = ?
                ORDER BY
                    CASE object_type
                        WHEN 'table' THEN 1
                        WHEN 'index' THEN 2
                        WHEN 'trigger' THEN 3
                        WHEN 'view' THEN 4
                        ELSE 5
                    END,
                    object_name
            `,
            args: [
                generationId
            ]
        });

    const schema =
        schemaResult.rows || [];

    if (!schema.length) {

        throw new Error(
            "Schéma SQLite absent dans Turso."
        );
    }

    if (
        fs.existsSync(
            OUTPUT_PATH
        )
    ) {

        fs.unlinkSync(
            OUTPUT_PATH
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

    const db =
        new sqlite3.Database(
            OUTPUT_PATH
        );

    await run(
        db,
        "PRAGMA foreign_keys = OFF"
    );

    const tables =
        schema.filter(
            object =>
                object.object_type ===
                "table"
        );

    /*
     * Création des tables d'abord.
     */
    for (const object of tables) {

        await run(
            db,
            String(
                object.sql
            )
        );
    }

    let totalRows = 0;

    for (const table of tables) {

        const rowsResult =
            await turso.execute({
                sql: `
                    SELECT
                        rowid_value,
                        row_json
                    FROM portfolio_mirror_rows
                    WHERE
                        generation_id = ?
                        AND table_name = ?
                    ORDER BY rowid_value
                `,
                args: [
                    generationId,
                    String(
                        table.object_name
                    )
                ]
            });

        const rows =
            rowsResult.rows || [];

        const pkColumns =
            JSON.parse(
                String(
                    table.pk_columns_json ||
                    "[]"
                )
            );

        for (const stored of rows) {

            const row =
                JSON.parse(
                    String(
                        stored.row_json
                    )
                );

            const columns =
                Object.keys(
                    row
                );

            if (!columns.length) {
                continue;
            }

            const placeholders =
                columns
                    .map(() => "?")
                    .join(", ");

            const columnSql =
                columns
                    .map(
                        quoteIdentifier
                    )
                    .join(", ");

            /*
             * Pour une table sans PK explicite,
             * on conserve également son ROWID.
             */
            if (!pkColumns.length) {

                await run(
                    db,
                    `
                    INSERT INTO ${quoteIdentifier(
                        table.object_name
                    )} (
                        rowid,
                        ${columnSql}
                    )
                    VALUES (
                        ?,
                        ${placeholders}
                    )
                    `,
                    [
                        stored.rowid_value,
                        ...columns.map(
                            column =>
                                row[column]
                        )
                    ]
                );

            } else {

                await run(
                    db,
                    `
                    INSERT INTO ${quoteIdentifier(
                        table.object_name
                    )} (
                        ${columnSql}
                    )
                    VALUES (
                        ${placeholders}
                    )
                    `,
                    columns.map(
                        column =>
                            row[column]
                    )
                );
            }
        }

        totalRows +=
            rows.length;

        console.log(
            `${table.object_name} : ${rows.length}`
        );
    }

    /*
     * Index, triggers et vues après les données.
     */
    for (
        const object of
        schema.filter(
            object =>
                object.object_type !==
                "table"
        )
    ) {

        await run(
            db,
            String(
                object.sql
            )
        );
    }

    await run(
        db,
        "PRAGMA foreign_keys = ON"
    );

    await closeDb(
        db
    );

    console.log("");
    console.log(
        `Total : ${totalRows} ligne(s)`
    );

    console.log(
        `✅ SQLite reconstruit : ${OUTPUT_PATH}`
    );
}


main().catch(error => {

    console.error("");
    console.error(
        "❌ Reconstruction Turso → SQLite impossible :"
    );

    console.error(error);

    process.exit(1);
});