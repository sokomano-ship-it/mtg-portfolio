const path = require("path");
const xlsx = require("xlsx");
const db = require("./database");

const excelPath = path.join(__dirname, "..", "uploads", "collection.xlsx");

function splitVersion(cardName) {
    const match = String(cardName || "").match(/\((V\.\d+)\)/i);
    if (!match) return { nomBase: String(cardName || "").trim(), version: null };

    return {
        nomBase: String(cardName || "").replace(match[0], "").trim(),
        version: match[1]
    };
}

function getCell(row, possibleNames) {
    for (const name of possibleNames) {
        if (row[name] !== undefined && row[name] !== null && row[name] !== "") {
            return row[name];
        }
    }
    return null;
}

function normalize(value) {
    return String(value || "").trim().toLowerCase();
}

function makeKey(card) {
    return [
        normalize(card.nomCarte),
        normalize(card.edition),
        normalize(card.langue),
        normalize(card.etat)
    ].join("|");
}

function run(sql, params = []) {
    return new Promise((resolve, reject) => {
        db.run(sql, params, function (err) {
            if (err) reject(err);
            else resolve(this);
        });
    });
}

function all(sql, params = []) {
    return new Promise((resolve, reject) => {
        db.all(sql, params, (err, rows) => {
            if (err) reject(err);
            else resolve(rows);
        });
    });
}

async function ensureColumn(table, column, definition) {
    const columns = await all(`PRAGMA table_info(${table})`);
    const exists = columns.some(col => col.name === column);

    if (!exists) {
        await run(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
        console.log(`Colonne ajoutée : ${column}`);
    }
}

async function importExcel() {
    try {
        await ensureColumn("cards", "isActive", "INTEGER DEFAULT 1");
        await ensureColumn("cards", "removedAt", "TEXT DEFAULT NULL");

        const workbook = xlsx.readFile(excelPath);
        const sheet = workbook.Sheets[workbook.SheetNames[0]];
        const rows = xlsx.utils.sheet_to_json(sheet);

        const existingCards = await all(`
            SELECT *
            FROM cards
            WHERE isActive IS NULL OR isActive = 1
            ORDER BY id ASC
        `);

        const existingByKey = new Map();

        for (const card of existingCards) {
            const key = makeKey(card);
            if (!existingByKey.has(key)) existingByKey.set(key, []);
            existingByKey.get(key).push(card);
        }

        const usedExistingIds = new Set();

        let inserted = 0;
        let updated = 0;
        let ignored = 0;

        for (const row of rows) {
            const nomCarte = getCell(row, ["NomCarte", "Nom Carte", "Carte", "Name", "Nom"]);
            const edition = getCell(row, ["Edition", "Édition", "Set"]);
            const langue = getCell(row, ["Langue", "Language"]);
            const etat = getCell(row, ["Etat", "État", "Condition"]);
            const categorie = getCell(row, [
                "Categorie",
                "Catégorie",
                "categorie",
                "category",
                "Category"
            ]);

            if (!nomCarte || !edition || !langue || !etat) {
                console.log("⚠️ Ligne ignorée, données manquantes :", row);
                ignored++;
                continue;
            }

            const info = splitVersion(nomCarte);

            const cleanCard = {
                nomCarte: String(nomCarte).trim(),
                nomBase: info.nomBase,
                version: info.version,
                edition: String(edition).trim(),
                langue: String(langue).trim(),
                etat: String(etat).trim(),
                categorie: categorie ? String(categorie).trim() : "Non classé"
            };

            const key = makeKey(cleanCard);
            const candidates = existingByKey.get(key) || [];
            const existing = candidates.find(card => !usedExistingIds.has(card.id));

            if (existing) {
                await run(
                    `
                    UPDATE cards
                    SET nomCarte = ?,
                        nomBase = ?,
                        version = ?,
                        edition = ?,
                        langue = ?,
                        etat = ?,
                        categorie = ?,
                        isActive = 1,
                        removedAt = NULL
                    WHERE id = ?
                    `,
                    [
                        cleanCard.nomCarte,
                        cleanCard.nomBase,
                        cleanCard.version,
                        cleanCard.edition,
                        cleanCard.langue,
                        cleanCard.etat,
                        cleanCard.categorie,
                        existing.id
                    ]
                );

                usedExistingIds.add(existing.id);
                updated++;
            } else {
                await run(
                    `
                    INSERT INTO cards (
                        nomCarte,
                        nomBase,
                        version,
                        edition,
                        langue,
                        etat,
                        categorie,
                        isActive,
                        removedAt
                    )
                    VALUES (?, ?, ?, ?, ?, ?, ?, 1, NULL)
                    `,
                    [
                        cleanCard.nomCarte,
                        cleanCard.nomBase,
                        cleanCard.version,
                        cleanCard.edition,
                        cleanCard.langue,
                        cleanCard.etat,
                        cleanCard.categorie
                    ]
                );

                inserted++;
            }
        }

        const today = new Date().toISOString().slice(0, 10);

        let removed = 0;

        for (const card of existingCards) {
            if (!usedExistingIds.has(card.id)) {
                await run(
                    `
                    UPDATE cards
                    SET isActive = 0,
                        removedAt = ?
                    WHERE id = ?
                    `,
                    [today, card.id]
                );
                removed++;
            }
        }

        console.log(`${rows.length} lignes Excel lues`);
        console.log(`${updated} cartes conservées / mises à jour`);
        console.log(`${inserted} nouvelles cartes ajoutées`);
        console.log(`${removed} cartes marquées inactives`);
        console.log(`${ignored} lignes ignorées`);
        console.log("Import terminé sans suppression de l'historique.");

        db.close();
    } catch (error) {
        console.error("Erreur import Excel :", error.message);
        db.close();
    }
}

importExcel();