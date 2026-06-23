const path = require("path");
const xlsx = require("xlsx");
const db = require("./database");

const excelPath = path.join(
    __dirname,
    "..",
    "uploads",
    "collection.xlsx"
);

function splitVersion(cardName) {
    const match = String(cardName || "").match(/\((V\.\d+)\)/i);

    if (!match) {
        return {
            nomBase: String(cardName || "").trim(),
            version: null
        };
    }

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

function run(sql, params = []) {
    return new Promise((resolve, reject) => {
        db.run(sql, params, err => {
            if (err) reject(err);
            else resolve();
        });
    });
}

async function importExcel() {
    try {
        const workbook = xlsx.readFile(excelPath);
        const sheet = workbook.Sheets[workbook.SheetNames[0]];
        const rows = xlsx.utils.sheet_to_json(sheet);

        await run("DELETE FROM cards");

        const stmt = db.prepare(`
            INSERT INTO cards (
                nomCarte,
                nomBase,
                version,
                edition,
                langue,
                etat,
                categorie
            )
            VALUES (?, ?, ?, ?, ?, ?, ?)
        `);

        rows.forEach(row => {
            const nomCarte = getCell(row, [
                "NomCarte",
                "Nom Carte",
                "Carte",
                "Name",
                "Nom"
            ]);

            const edition = getCell(row, [
                "Edition",
                "Édition",
                "Set"
            ]);

            const langue = getCell(row, [
                "Langue",
                "Language"
            ]);

            const etat = getCell(row, [
                "Etat",
                "État",
                "Condition"
            ]);

            const categorie = getCell(row, [
                "Categorie",
                "Catégorie",
                "categorie",
                "category",
                "Category"
            ]);

            if (!nomCarte || !edition || !langue || !etat) {
                console.log("⚠️ Ligne ignorée, données manquantes :", row);
                return;
            }

            const info = splitVersion(nomCarte);

            stmt.run(
                String(nomCarte).trim(),
                info.nomBase,
                info.version,
                String(edition).trim(),
                String(langue).trim(),
                String(etat).trim(),
                categorie ? String(categorie).trim() : "Non classé"
            );
        });

        stmt.finalize(err => {
            if (err) {
                console.error("Erreur insertion :", err.message);
                db.close();
                return;
            }

            console.log(`${rows.length} lignes Excel lues`);
            console.log("Import terminé.");
            console.log("Historique conservé.");
            db.close();
        });
    } catch (error) {
        console.error("Erreur import Excel :", error.message);
        db.close();
    }
}

importExcel();