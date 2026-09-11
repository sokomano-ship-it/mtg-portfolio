require("dotenv").config();

const path = require("path");
const sqlite3 = require("sqlite3").verbose();

const turso = require("./turso");

const DB_PATH =
    path.join(
        __dirname,
        "..",
        "database",
        "portfolio.db"
    );

const DRY_RUN =
    process.argv.includes("--dry-run");

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

    if (!statements.length) {
        return;
    }

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


function sameValue(
    localRow,
    remoteRow,
    hasPrimaryKey
) {

    if (!remoteRow) {
        return false;
    }

    /*
     * Pour les tables avec PK, ROWID n'est pas nécessaire
     * à la reconstruction SQLite.
     *
     * On évite donc de considérer un simple changement
     * de ROWID comme une modification réelle.
     */
    if (!hasPrimaryKey) {

        if (
            Number(localRow.rowidValue) !==
            Number(remoteRow.rowidValue)
        ) {
            return false;
        }
    }

    return (
        localRow.rowJson ===
        remoteRow.rowJson
    );
}


async function main() {

    console.log(
        DRY_RUN
            ? "Mode DRY-RUN : aucune écriture Turso."
            : "Synchronisation SQLite → Turso incrémentale."
    );

    /*
     * On réutilise impérativement la génération actuellement
     * active.
     *
     * On ne crée plus une nouvelle génération complète à chaque
     * exécution.
     */
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
            "Aucune génération SQLite active n'est disponible dans Turso. " +
            "Synchronisation incrémentale annulée afin d'éviter une copie complète accidentelle."
        );
    }

    console.log(
        `Génération Turso active : ${generationId}`
    );


    /*
     * Schéma SQLite local.
     */
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
                object.type === "table"
        );

    const tableInfo =
        new Map();

    for (const table of tables) {

        const escaped =
            table.name.replace(
                /"/g,
                '""'
            );

        const columns =
            await all(
                `PRAGMA table_info("${escaped}")`
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


    /*
     * ----------------------------------------------------------
     * SCHÉMA
     * ----------------------------------------------------------
     */

    const remoteSchemaResult =
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
            `,
            args: [
                generationId
            ]
        });

    const remoteSchemaMap =
        new Map();

    for (
        const object of
        remoteSchemaResult.rows || []
    ) {

        remoteSchemaMap.set(
            `${object.object_type}|${object.object_name}`,
            {
                tableName:
                    object.table_name == null
                        ? null
                        : String(
                            object.table_name
                        ),

                sql:
                    object.sql == null
                        ? null
                        : String(
                            object.sql
                        ),

                pkColumnsJson:
                    String(
                        object.pk_columns_json ||
                        "[]"
                    )
            }
        );
    }

    const localSchemaKeys =
        new Set();

    const schemaWrites = [];

    let schemaNew = 0;
    let schemaModified = 0;
    let schemaDeleted = 0;

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

        const key =
            `${object.type}|${object.name}`;

        localSchemaKeys.add(
            key
        );

        const localValue = {
            tableName:
                object.tableName == null
                    ? null
                    : String(
                        object.tableName
                    ),

            sql:
                object.sql == null
                    ? null
                    : String(
                        object.sql
                    ),

            pkColumnsJson:
                JSON.stringify(
                    pkColumns
                )
        };

        const remoteValue =
            remoteSchemaMap.get(
                key
            );

        const changed =
            !remoteValue ||
            remoteValue.tableName !==
                localValue.tableName ||
            remoteValue.sql !==
                localValue.sql ||
            remoteValue.pkColumnsJson !==
                localValue.pkColumnsJson;

        if (!changed) {
            continue;
        }

        if (remoteValue) {
            schemaModified++;
        } else {
            schemaNew++;
        }

        schemaWrites.push({
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

                ON CONFLICT (
                    generation_id,
                    object_type,
                    object_name
                )

                DO UPDATE SET
                    table_name =
                        excluded.table_name,
                    sql =
                        excluded.sql,
                    pk_columns_json =
                        excluded.pk_columns_json
            `,
            args: [
                generationId,
                object.type,
                object.name,
                localValue.tableName,
                localValue.sql,
                localValue.pkColumnsJson
            ]
        });
    }


    for (
        const [
            key
        ] of
        remoteSchemaMap
    ) {

        if (
            localSchemaKeys.has(
                key
            )
        ) {
            continue;
        }

        const separator =
            key.indexOf("|");

        const objectType =
            key.slice(
                0,
                separator
            );

        const objectName =
            key.slice(
                separator + 1
            );

        schemaDeleted++;

        schemaWrites.push({
            sql: `
                DELETE FROM portfolio_mirror_schema
                WHERE
                    generation_id = ?
                    AND object_type = ?
                    AND object_name = ?
            `,
            args: [
                generationId,
                objectType,
                objectName
            ]
        });
    }


    /*
     * ----------------------------------------------------------
     * DONNÉES
     * ----------------------------------------------------------
     */

    const counts = {};

    let totalRows = 0;

    let totalNew = 0;
    let totalModified = 0;
    let totalDeleted = 0;
    let totalUnchanged = 0;

    const dataWrites = [];


    for (const table of tables) {

        const escaped =
            table.name.replace(
                /"/g,
                '""'
            );

        const rows =
            await all(`
                SELECT
                    rowid AS __mirror_rowid,
                    *
                FROM "${escaped}"
            `);

        const pkColumns =
            tableInfo.get(
                table.name
            )?.pkColumns || [];

        const hasPrimaryKey =
            pkColumns.length > 0;


        /*
         * Lecture de l'état Turso actuel pour cette table.
         *
         * Cette opération consomme des lectures mais aucune
         * écriture.
         */
        const remoteResult =
            await turso.execute({
                sql: `
                    SELECT
                        row_key,
                        rowid_value,
                        row_json
                    FROM portfolio_mirror_rows
                    WHERE
                        generation_id = ?
                        AND table_name = ?
                `,
                args: [
                    generationId,
                    table.name
                ]
            });

        const remoteMap =
            new Map();

        for (
            const remoteRow of
            remoteResult.rows || []
        ) {

            remoteMap.set(
                String(
                    remoteRow.row_key
                ),
                {
                    rowidValue:
                        remoteRow.rowid_value,

                    rowJson:
                        String(
                            remoteRow.row_json
                        )
                }
            );
        }


        const localKeys =
            new Set();

        let tableNew = 0;
        let tableModified = 0;
        let tableDeleted = 0;
        let tableUnchanged = 0;


        for (const row of rows) {

            const rowid =
                row.__mirror_rowid;

            const storedRow = {
                ...row
            };

            delete storedRow
                .__mirror_rowid;

            const rowKey =
                makeRowKey(
                    row,
                    pkColumns
                );

            const rowJson =
                JSON.stringify(
                    storedRow
                );

            localKeys.add(
                rowKey
            );

            const localValue = {
                rowidValue:
                    rowid,

                rowJson
            };

            const remoteValue =
                remoteMap.get(
                    rowKey
                );

            if (
                sameValue(
                    localValue,
                    remoteValue,
                    hasPrimaryKey
                )
            ) {

                tableUnchanged++;
                continue;
            }

            if (remoteValue) {
                tableModified++;
            } else {
                tableNew++;
            }


            dataWrites.push({
                sql: `
                    INSERT INTO portfolio_mirror_rows (
                        generation_id,
                        table_name,
                        row_key,
                        rowid_value,
                        row_json
                    )
                    VALUES (?, ?, ?, ?, ?)

                    ON CONFLICT (
                        generation_id,
                        table_name,
                        row_key
                    )

                    DO UPDATE SET
                        rowid_value =
                            excluded.rowid_value,
                        row_json =
                            excluded.row_json
                `,
                args: [
                    generationId,
                    table.name,
                    rowKey,
                    rowid,
                    rowJson
                ]
            });
        }


        /*
         * Une ligne qui existe dans Turso mais plus dans SQLite
         * doit être supprimée du miroir.
         */
        for (
    const [
        remoteKey
    ] of
    remoteMap
) {

    if (
        localKeys.has(
            remoteKey
        )
    ) {
        continue;
    }

    /*
     * Sécurité :
     * une ligne présente uniquement dans Turso n'est PAS
     * supprimée automatiquement.
     *
     * Cela protège notamment contre le cas où le SQLite local
     * serait plus ancien que le snapshot Turso.
     */
    tableDeleted++;
}


        counts[table.name] =
            rows.length;

        totalRows +=
            rows.length;

        totalNew +=
            tableNew;

        totalModified +=
            tableModified;

        totalDeleted +=
            tableDeleted;

        totalUnchanged +=
            tableUnchanged;


        console.log(
            `${table.name} : ` +
            `${rows.length} lignes | ` +
            `+${tableNew} nouvelles | ` +
            `~${tableModified} modifiées | ` +
            `-${tableDeleted} absentes localement | ` +
            `=${tableUnchanged} inchangées`
        );
    }


    console.log("");
    console.log(
        `Total SQLite : ${totalRows} ligne(s)`
    );

    console.log(
        `Inchangées   : ${totalUnchanged}`
    );

    console.log(
        `Nouvelles    : ${totalNew}`
    );

    console.log(
        `Modifiées    : ${totalModified}`
    );

    console.log(
        `Absentes localement   : ${totalDeleted}`
    );

    console.log(
    `Écritures données prévues : ${dataWrites.length}`
);

if (totalDeleted > 0) {
    console.warn(
        `⚠️ ${totalDeleted} ligne(s) existent dans Turso mais pas dans SQLite. ` +
        `Elles ne seront PAS supprimées automatiquement.`
    );
}

    console.log(
        `Écritures schéma prévues  : ${schemaWrites.length}`
    );


    /*
     * ----------------------------------------------------------
     * DRY RUN
     * ----------------------------------------------------------
     */

    if (DRY_RUN) {

        console.log("");
        console.log(
            "✅ DRY-RUN terminé."
        );

        console.log(
            "Aucune écriture n'a été effectuée dans Turso."
        );

        await closeDb();
        return;
    }


    /*
     * ----------------------------------------------------------
     * ÉCRITURE RÉELLE
     * ----------------------------------------------------------
     *
     * Le pointeur current_generation ne change pas.
     * La génération active reste un snapshot complet.
     */

    await writeBatch(
        schemaWrites
    );

    await writeBatch(
        dataWrites
    );


    /*
     * On met uniquement à jour les compteurs.
     *
     * Ceci représente une seule écriture supplémentaire.
     */
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
                value =
                    excluded.value,
                updated_at =
                    CURRENT_TIMESTAMP
        `,
        args: [
            JSON.stringify(
                counts
            )
        ]
    });


    console.log("");
    console.log(
        `✅ SQLite synchronisé incrémentalement dans Turso.`
    );

    console.log(
        `Génération conservée : ${generationId}`
    );

    console.log(
        `Écritures données : ${dataWrites.length}`
    );

    console.log(
        `Écritures schéma  : ${schemaWrites.length}`
    );

    console.log(
        `Écriture metadata : 1`
    );

    console.log(
        `Total écritures approximatif : ${
            dataWrites.length +
            schemaWrites.length +
            1
        }`
    );


    await closeDb();
}


main().catch(async error => {

    console.error("");
    console.error(
        "❌ Synchronisation SQLite → Turso impossible :"
    );

    console.error(
        error
    );

    try {
        await closeDb();
    } catch {
        // rien
    }

    process.exit(1);
});