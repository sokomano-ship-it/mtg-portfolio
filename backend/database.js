const sqlite3 = require("sqlite3").verbose();
const path = require("path");
const fs = require("fs");

const defaultDbPath = path.join(__dirname, "..", "database", "portfolio.db");
const dbPath = process.env.DB_PATH || defaultDbPath;

const dbDir = path.dirname(dbPath);

if (!fs.existsSync(dbDir)) {
    fs.mkdirSync(dbDir, { recursive: true });
}

if (!fs.existsSync(dbPath) && fs.existsSync(defaultDbPath)) {
    fs.copyFileSync(defaultDbPath, dbPath);
    console.log(`Base copiée vers ${dbPath}`);
}

const db = new sqlite3.Database(dbPath);

function addColumnIfMissing(table, column, definition) {
    db.all(`PRAGMA table_info(${table})`, [], (err, rows) => {
        if (err) {
            console.error(err.message);
            return;
        }

        const exists = rows.some(row => row.name === column);

        if (!exists) {
            db.run(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
        }
    });
}

db.serialize(() => {
    db.run(`
        CREATE TABLE IF NOT EXISTS cards (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            nomCarte TEXT NOT NULL,
            nomBase TEXT,
            version TEXT,
            edition TEXT NOT NULL,
            langue TEXT NOT NULL,
            etat TEXT NOT NULL,
            categorie TEXT,
            scryfallId TEXT,
            imageUrl TEXT,
            priceUsd REAL,
            priceEur REAL,
            cardmarketId INTEGER,
            createdAt DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    `);

    addColumnIfMissing("cards", "nomBase", "TEXT");
    addColumnIfMissing("cards", "version", "TEXT");
    addColumnIfMissing("cards", "categorie", "TEXT");
    addColumnIfMissing("cards", "scryfallId", "TEXT");
    addColumnIfMissing("cards", "imageUrl", "TEXT");
    addColumnIfMissing("cards", "priceUsd", "REAL");
    addColumnIfMissing("cards", "priceEur", "REAL");
    addColumnIfMissing("cards", "cardmarketId", "INTEGER");

    db.run(`
        CREATE TABLE IF NOT EXISTS cardmarket_prices (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            cardId INTEGER NOT NULL,
            date TEXT NOT NULL,
            trendPrice REAL,
            lowPrice REAL,
            avgPrice REAL,
            avg1 REAL,
            avg7 REAL,
            avg30 REAL,
            availableArticles INTEGER,
            sourceUrl TEXT,
            createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY(cardId) REFERENCES cards(id)
        )
    `);

    addColumnIfMissing("cardmarket_prices", "avg1", "REAL");
    addColumnIfMissing("cardmarket_prices", "avg7", "REAL");
    addColumnIfMissing("cardmarket_prices", "avg30", "REAL");
    addColumnIfMissing("cardmarket_prices", "sourceUrl", "TEXT");

    db.run(`
        CREATE TABLE IF NOT EXISTS portfolio_history (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            date TEXT UNIQUE,
            totalValue REAL,
            createdAt DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    `);

    db.run(`
        CREATE TABLE IF NOT EXISTS card_price_history (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            cardId INTEGER NOT NULL,
            date TEXT NOT NULL,
            trendPrice REAL,
            avgPrice REAL,
            lowPrice REAL,
            createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(cardId, date),
            FOREIGN KEY(cardId) REFERENCES cards(id)
        )
    `);
});

module.exports = db;