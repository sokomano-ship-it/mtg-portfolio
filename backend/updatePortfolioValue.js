const db = require("./database");
const { calculateEtatPrice } = require("./conditionPricing");

function getLatestPrices() {
    return new Promise((resolve, reject) => {
        db.all(
            `
            SELECT
                c.id,
                c.nomCarte,
                c.edition,
                c.langue,
                c.etat,
                cp.trendPrice,
                cp.avgPrice,
                cp.lowPrice
            FROM cards c
            JOIN cardmarket_prices cp
                ON cp.id = (
                    SELECT MAX(id)
                    FROM cardmarket_prices
                    WHERE cardId = c.id
                )
            `,
            [],
            (err, rows) => {
                if (err) reject(err);
                else resolve(rows);
            }
        );
    });
}

function savePortfolioValue(value) {
    return new Promise((resolve, reject) => {
        const today = new Date().toISOString().slice(0, 10);

        db.run(
            `
            INSERT OR REPLACE INTO portfolio_history (
                date,
                totalValue
            )
            VALUES (?, ?)
            `,
            [today, value],
            err => {
                if (err) reject(err);
                else resolve();
            }
        );
    });
}

function saveCardHistory(cards) {
    return new Promise((resolve, reject) => {
        const today = new Date().toISOString().slice(0, 10);

        const stmt = db.prepare(`
            INSERT OR REPLACE INTO card_price_history (
                cardId,
                date,
                trendPrice,
                avgPrice,
                lowPrice
            )
            VALUES (?, ?, ?, ?, ?)
        `);

        cards.forEach(card => {
            const prixEtat = calculateEtatPrice(
                card.trendPrice,
                card.etat,
                card.edition,
                card.langue
            );

            stmt.run(
                card.id,
                today,
                prixEtat,
                card.avgPrice,
                card.lowPrice
            );
        });

        stmt.finalize(err => {
            if (err) reject(err);
            else resolve();
        });
    });
}

async function main() {
    const cards = await getLatestPrices();

    let total = 0;

    cards.forEach(card => {
        const prixEtat = calculateEtatPrice(
            card.trendPrice,
            card.etat,
            card.edition,
            card.langue
        );

        total += prixEtat;
    });

    await savePortfolioValue(total);
    await saveCardHistory(cards);

    console.log(`💰 Valeur portefeuille prix-etat : ${total.toFixed(2)} €`);
    console.log(`📈 Historique prix-etat enregistré : ${cards.length} cartes`);

    db.close();
}

main().catch(error => {
    console.error(error);
    db.close();
});