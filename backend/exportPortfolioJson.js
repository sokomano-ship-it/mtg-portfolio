const fs = require("fs");
const path = require("path");
const db = require("./database");
const { calculateEtatPrice } = require("./conditionPricing");
const { buildNmOpportunities } = require("./opportunityScoring");

const outputDir = path.join(__dirname, "..", "frontend", "data");
const outputFile = path.join(outputDir, "portfolio.json");
const pricingSimulationFile = path.join(__dirname, "data", "pricingSimulation.json");
const referenceCatalogFile = path.join(__dirname, "data", "referenceCatalog.json");
const estimatedPriceHistoryFile = path.join(__dirname, "..", "frontend", "data", "estimated-price-history.json");

function all(sql, params = []) {
    return new Promise((resolve, reject) => {
        db.all(sql, params, (err, rows) => {
            if (err) reject(err);
            else resolve(rows);
        });
    });
}

function readPricingSimulation() {
    if (!fs.existsSync(pricingSimulationFile)) return new Map();

    const rows = JSON.parse(fs.readFileSync(pricingSimulationFile, "utf8"));

    return new Map(
        rows.map(row => [Number(row.id), row])
    );
}

function readEstimatedPriceHistory() {
    if (!fs.existsSync(estimatedPriceHistoryFile)) return [];
    return JSON.parse(fs.readFileSync(estimatedPriceHistoryFile, "utf8"));
}

function readReferenceCatalog() {
    if (!fs.existsSync(referenceCatalogFile)) return new Map();

    const rows = JSON.parse(fs.readFileSync(referenceCatalogFile, "utf8"));

    return new Map(
        rows.map(row => [Number(row.cardId), row])
    );
}

function applyReferenceCatalog(card, referenceCatalogMap) {
    const ref = referenceCatalogMap.get(Number(card.id));

    if (!ref?.displayCard) return card;

    return {
        ...card,
        imageUrl: ref.displayCard.image || card.imageUrl,
        scryfallUri: ref.displayCard.scryfallUri || card.scryfallUri
    };
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

function addPricingSimulation(card, pricingMap) {
    const simulation = pricingMap.get(Number(card.id));

    return {
        ...card,

        estimatedPrice: simulation?.estimatedPrice ?? null,
        pricingModel: simulation?.pricingModel ?? null,
        pricingConfidence: simulation?.confidence ?? null,
        pricingRatio: simulation?.ratioUsed ?? null,
        pricingObservationCount: simulation?.observationCount ?? 0,
        marketAnchorPrice: simulation?.marketAnchorPrice ?? null,
        referenceMarketAnchorPrice: simulation?.referenceMarketAnchorPrice ?? null
    };
}

function groupByCardEditionEtat(rows) {
    const grouped = new Map();

    rows.forEach(row => {
        const key = [
            row.nomCarte,
            row.edition,
            row.etat
        ].join("|");

        if (!grouped.has(key)) {
            grouped.set(key, {
                ...row,
                quantity: 1
            });
        } else {
            grouped.get(key).quantity += 1;
        }
    });

    return [...grouped.values()];
}

async function main() {
    const pricingMap = readPricingSimulation();
    const estimatedPriceHistory = readEstimatedPriceHistory();
    const referenceCatalogMap = readReferenceCatalog();

    const cardsRaw = await all(`
        SELECT
            c.*,
            cp.trendPrice,
            cp.lowPrice,
            cp.avgPrice,
            cp.avg1,
            cp.avg7,
            cp.avg30
        FROM cards c
        LEFT JOIN cardmarket_prices cp
            ON cp.id = (
                SELECT MAX(id)
                FROM cardmarket_prices
                WHERE cardId = c.id
            )
        ORDER BY c.edition, c.nomCarte
    `);

    const cards = cardsRaw
    .map(addPrixEtat)
    .map(card => addPricingSimulation(card, pricingMap))
    .map(card => applyReferenceCatalog(card, referenceCatalogMap));

    const categoryMap = {};

    cards.forEach(card => {
        const categorie = card.categorie || "Non classé";
        const value = Number(card.estimatedPrice ?? card.prixEtat ?? 0);

        if (!categoryMap[categorie]) {
            categoryMap[categorie] = {
                categorie,
                cardsCount: 0,
                totalValue: 0
            };
        }

        categoryMap[categorie].cardsCount += 1;
        categoryMap[categorie].totalValue += value;
    });

    const categorySummary = Object.values(categoryMap)
        .map(row => ({
            ...row,
            totalValue: Number(row.totalValue.toFixed(2))
        }))
        .sort((a, b) => b.totalValue - a.totalValue);

    const portfolioHistory = await all(`
        SELECT
            date,
            ROUND(totalValue, 2) AS totalValue
        FROM portfolio_history
        ORDER BY date
    `);

    const estimatedTotalValue = cards.reduce(
        (sum, card) => sum + Number(card.estimatedPrice ?? card.prixEtat ?? 0),
        0
    );
    const todayDate = new Date().toISOString().slice(0, 10);

const portfolioHistoryEstimated = [
    ...portfolioHistory.filter(row => row.date !== todayDate),
    {
        date: todayDate,
        totalValue: Number(estimatedTotalValue.toFixed(2))
    }
];

    const valuedCardsCount = cards.filter(card => Number(card.estimatedPrice || 0) > 0).length;
    const missingEstimatedCardsCount = cards.length - valuedCardsCount;

    const averageConfidenceRows = cards
        .map(card => Number(card.pricingConfidence || 0))
        .filter(Boolean);

    const averagePricingConfidence = averageConfidenceRows.length
        ? averageConfidenceRows.reduce((a, b) => a + b, 0) / averageConfidenceRows.length
        : 0;

    const lastTwo = await all(`
        SELECT
            date,
            ROUND(totalValue, 2) AS totalValue
        FROM portfolio_history
        ORDER BY date DESC
        LIMIT 2
    `);

    const today = Number(estimatedTotalValue.toFixed(2));
    const yesterday = lastTwo[0]?.totalValue || today;
    const change = today - yesterday;
    const changePct = yesterday > 0 ? (change / yesterday) * 100 : 0;

    const portfolioSummary = {
        today: Number(today.toFixed(2)),
estimatedTotalValue: Number(estimatedTotalValue.toFixed(2)),
        yesterday: Number(yesterday.toFixed(2)),
        change: Number(change.toFixed(2)),
        changePct: Number(changePct.toFixed(2)),
        estimatedTotalValue: Number(estimatedTotalValue.toFixed(2)),
        valuedCardsCount,
        missingEstimatedCardsCount,
        averagePricingConfidence: Number(averagePricingConfidence.toFixed(0))
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
            c.id,
            c.nomCarte,
            c.edition,
            c.etat,
            c.version,
            c.langue,

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
            const aScore =
                a.perf30d ??
                a.perf7d ??
                a.perf90d ??
                a.perf180d ??
                a.perf365d ??
                0;

            const bScore =
                b.perf30d ??
                b.perf7d ??
                b.perf90d ??
                b.perf180d ??
                b.perf365d ??
                0;

            return bScore - aScore;
        });

    const opportunities = buildNmOpportunities(cards);

    const cardDetails = {};

    for (const card of cards) {
        const history = await all(`
            SELECT
                date,
                trendPrice,
                avgPrice,
                lowPrice
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

            return calculatePerformance(
                Number(current.trendPrice),
                Number(previous.trendPrice)
            );
        }

        const estimatedHistory = estimatedPriceHistory
    .filter(row => Number(row.cardId) === Number(card.id))
    .sort((a, b) => String(a.date).localeCompare(String(b.date)));

        cardDetails[String(card.id)] = {
            card,
            history,
            estimatedHistory,
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
            portfolioHistory: portfolioHistoryEstimated,
            portfolioSummary,
            topMovers,
            opportunities,
            cardDetails
        }, null, 2),
        "utf8"
    );

    console.log(`Export JSON généré : ${outputFile}`);
    console.log(`${cards.length} cartes exportées`);
    console.log(`${opportunities.length} opportunités NM calculées`);
    console.log(`Valeur estimée V2 : ${estimatedTotalValue.toFixed(2)} €`);
    console.log(`Confiance moyenne : ${averagePricingConfidence.toFixed(0)}%`);

    db.close();
}

main().catch(error => {
    console.error(error);
    process.exit(1);
});