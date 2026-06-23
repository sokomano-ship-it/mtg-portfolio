const fs = require("fs");
const path = require("path");
const db = require("./database");
const { calculateEtatPrice } = require("./conditionPricing");

const outputDir = path.join(__dirname, "..", "frontend", "data");
const outputFile = path.join(outputDir, "portfolio.json");

function all(sql, params = []) {
    return new Promise((resolve, reject) => {
        db.all(sql, params, (err, rows) => {
            if (err) reject(err);
            else resolve(rows);
        });
    });
}

function get(sql, params = []) {
    return new Promise((resolve, reject) => {
        db.get(sql, params, (err, row) => {
            if (err) reject(err);
            else resolve(row);
        });
    });
}

function calculatePerformance(current, previous) {
    if (!current || !previous || previous <= 0) return null;
    return Number((((current - previous) / previous) * 100).toFixed(2));
}

function addPrixEtat(card) {
    return {
        ...card,
        prixEtat: calculateEtatPrice(
            card.trendPrice,
            card.etat,
            card.edition,
            card.langue
        )
    };
}

function groupByCardEditionEtat(rows) {
    const grouped = new Map();

    rows.forEach(row => {
        const key = [row.nomCarte, row.edition, row.etat].join("|");

        if (!grouped.has(key)) {
            grouped.set(key, { ...row, quantity: 1 });
        } else {
            grouped.get(key).quantity += 1;
        }
    });

    return [...grouped.values()];
}

function computeOpportunity(card) {
    const trend = Number(card.trendPrice) || 0;
    const avg1 = Number(card.avg1) || 0;
    const avg7 = Number(card.avg7) || 0;
    const avg30 = Number(card.avg30) || 0;

    const trendVs30 = avg30 > 0 ? ((trend - avg30) / avg30) * 100 : 0;
    const avg7Vs30 = avg7 > 0 && avg30 > 0 ? ((avg7 - avg30) / avg30) * 100 : 0;
    const avg1Vs7 = avg1 > 0 && avg7 > 0 ? ((avg1 - avg7) / avg7) * 100 : 0;

    const score = trendVs30 * 0.5 + avg7Vs30 * 0.35 + avg1Vs7 * 0.15;

    let signal = "Neutre";
    if (score >= 20) signal = "🔥 Forte hausse";
    else if (score >= 10) signal = "📈 Hausse";
    else if (score <= -10) signal = "📉 Baisse";

    return {
        ...addPrixEtat(card),
        trendVs30: Number(trendVs30.toFixed(1)),
        avg7Vs30: Number(avg7Vs30.toFixed(1)),
        avg1Vs7: Number(avg1Vs7.toFixed(1)),
        score: Number(score.toFixed(1)),
        signal
    };
}

async function main() {
    const cardsRaw = await all(`
        SELECT c.*, cp.trendPrice, cp.lowPrice, cp.avgPrice, cp.avg1, cp.avg7, cp.avg30
        FROM cards c
        LEFT JOIN cardmarket_prices cp
            ON cp.id = (
                SELECT MAX(id)
                FROM cardmarket_prices
                WHERE cardId = c.id
            )
        ORDER BY c.edition, c.nomCarte
    `);

    const cards = cardsRaw.map(addPrixEtat);

    const categoryMap = {};
    cards.forEach(card => {
        const categorie = card.categorie || "Non classé";
        if (!categoryMap[categorie]) {
            categoryMap[categorie] = {
                categorie,
                cardsCount: 0,
                totalValue: 0
            };
        }
        categoryMap[categorie].cardsCount += 1;
        categoryMap[categorie].totalValue += Number(card.prixEtat || 0);
    });

    const categorySummary = Object.values(categoryMap)
        .map(row => ({
            ...row,
            totalValue: Number(row.totalValue.toFixed(2))
        }))
        .sort((a, b) => b.totalValue - a.totalValue);

    const portfolioHistory = await all(`
        SELECT date, ROUND(totalValue, 2) AS totalValue
        FROM portfolio_history
        ORDER BY date
    `);

    const lastTwo = await all(`
        SELECT date, ROUND(totalValue, 2) AS totalValue
        FROM portfolio_history
        ORDER BY date DESC
        LIMIT 2
    `);

    const today = lastTwo[0]?.totalValue || 0;
    const yesterday = lastTwo[1]?.totalValue || today;
    const change = today - yesterday;
    const changePct = yesterday > 0 ? (change / yesterday) * 100 : 0;

    const portfolioSummary = {
        today: Number(today.toFixed(2)),
        yesterday: Number(yesterday.toFixed(2)),
        change: Number(change.toFixed(2)),
        changePct: Number(changePct.toFixed(2))
    };

    const moverRows = await all(`
        WITH
        current AS (
            SELECT h.*
            FROM card_price_history h
            JOIN (
                SELECT cardId, MAX(id) AS maxId
                FROM card_price_history
                GROUP BY cardId
            ) x ON x.maxId = h.id
        ),
        d7 AS (
            SELECT h.*
            FROM card_price_history h
            JOIN (
                SELECT cardId, MAX(id) AS maxId
                FROM card_price_history
                WHERE date <= date('now', '-7 days')
                GROUP BY cardId
            ) x ON x.maxId = h.id
        ),
        d30 AS (
            SELECT h.*
            FROM card_price_history h
            JOIN (
                SELECT cardId, MAX(id) AS maxId
                FROM card_price_history
                WHERE date <= date('now', '-30 days')
                GROUP BY cardId
            ) x ON x.maxId = h.id
        ),
        d90 AS (
            SELECT h.*
            FROM card_price_history h
            JOIN (
                SELECT cardId, MAX(id) AS maxId
                FROM card_price_history
                WHERE date <= date('now', '-90 days')
                GROUP BY cardId
            ) x ON x.maxId = h.id
        ),
        d180 AS (
            SELECT h.*
            FROM card_price_history h
            JOIN (
                SELECT cardId, MAX(id) AS maxId
                FROM card_price_history
                WHERE date <= date('now', '-180 days')
                GROUP BY cardId
            ) x ON x.maxId = h.id
        ),
        d365 AS (
            SELECT h.*
            FROM card_price_history h
            JOIN (
                SELECT cardId, MAX(id) AS maxId
                FROM card_price_history
                WHERE date <= date('now', '-365 days')
                GROUP BY cardId
            ) x ON x.maxId = h.id
        )
        SELECT
            c.id, c.nomCarte, c.edition, c.etat, c.version, c.langue,
            current.trendPrice AS currentPrice,
            d7.trendPrice AS price7d,
            d30.trendPrice AS price30d,
            d90.trendPrice AS price90d,
            d180.trendPrice AS price180d,
            d365.trendPrice AS price365d
        FROM cards c
        LEFT JOIN current ON current.cardId = c.id
        LEFT JOIN d7 ON d7.cardId = c.id
        LEFT JOIN d30 ON d30.cardId = c.id
        LEFT JOIN d90 ON d90.cardId = c.id
        LEFT JOIN d180 ON d180.cardId = c.id
        LEFT JOIN d365 ON d365.cardId = c.id
    `);

    const topMovers = groupByCardEditionEtat(
        moverRows.filter(row => row.currentPrice)
    )
        .map(row => ({
            ...row,
            currentPrice: Number(row.currentPrice || 0),
            perf7d: calculatePerformance(row.currentPrice, row.price7d),
            perf30d: calculatePerformance(row.currentPrice, row.price30d),
            perf90d: calculatePerformance(row.currentPrice, row.price90d),
            perf180d: calculatePerformance(row.currentPrice, row.price180d),
            perf365d: calculatePerformance(row.currentPrice, row.price365d)
        }))
        .sort((a, b) => {
            const aScore = a.perf30d ?? a.perf7d ?? a.perf90d ?? a.perf180d ?? a.perf365d ?? 0;
            const bScore = b.perf30d ?? b.perf7d ?? b.perf90d ?? b.perf180d ?? b.perf365d ?? 0;
            return bScore - aScore;
        });

    const opportunityRows = await all(`
        SELECT c.*, cp.trendPrice, cp.lowPrice, cp.avgPrice, cp.avg1, cp.avg7, cp.avg30
        FROM cards c
        JOIN cardmarket_prices cp
            ON cp.id = (
                SELECT MAX(id)
                FROM cardmarket_prices
                WHERE cardId = c.id
            )
        WHERE cp.trendPrice IS NOT NULL
          AND cp.avg30 IS NOT NULL
          AND cp.avg30 > 0
    `);

    const computedOpportunities = opportunityRows.map(computeOpportunity);
    const groupedOpportunities = groupByCardEditionEtat(computedOpportunities)
        .map(row => ({
            ...row,
            quantity: Number(row.quantity || 1)
        }));

    const best = [...groupedOpportunities]
        .sort((a, b) => Number(b.score || 0) - Number(a.score || 0))
        .slice(0, 30);

    const worst = [...groupedOpportunities]
        .sort((a, b) => Number(a.score || 0) - Number(b.score || 0))
        .slice(0, 10);

    const opportunityMap = new Map();
    [...best, ...worst].forEach(row => {
        const key = [row.nomCarte, row.edition, row.etat].join("|");
        opportunityMap.set(key, row);
    });

    const opportunities = [...opportunityMap.values()]
        .sort((a, b) => Number(b.score || 0) - Number(a.score || 0));

    const cardDetails = {};
    for (const card of cards) {
        const history = await all(`
            SELECT date, trendPrice, avgPrice, lowPrice
            FROM card_price_history
            WHERE cardId = ?
            ORDER BY date
        `, [card.id]);

        const current = history[history.length - 1];

        function perf(days) {
            if (!history.length || !current) return null;
            const targetDate = new Date();
            targetDate.setDate(targetDate.getDate() - days);

            const previous = [...history]
                .reverse()
                .find(row => new Date(row.date) <= targetDate);

            if (!previous) return null;
            return calculatePerformance(Number(current.trendPrice), Number(previous.trendPrice));
        }

        cardDetails[String(card.id)] = {
            card,
            history,
            performance: {
                perf7d: perf(7),
                perf30d: perf(30),
                perf90d: perf(90),
                perf180d: perf(180),
                perf365d: perf(365)
            }
        };
    }

    fs.mkdirSync(outputDir, { recursive: true });

    fs.writeFileSync(
        outputFile,
        JSON.stringify({
            generatedAt: new Date().toISOString(),
            cards,
            categorySummary,
            portfolioHistory,
            portfolioSummary,
            topMovers,
            opportunities,
            cardDetails
        }, null, 2),
        "utf8"
    );

    console.log(`Export JSON généré : ${outputFile}`);
    db.close();
}

main().catch(error => {
    console.error(error);
    process.exit(1);
});