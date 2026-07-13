const fs = require("fs");
const path = require("path");
const db = require("./database");
const { calculateEtatPrice } = require("./conditionPricing");
const { buildNmOpportunities } = require("./opportunityScoring");

const outputDir = path.join(__dirname, "..", "frontend", "data");
const MODEL_START_DATE = "2026-07-12";

const pricingSimulationFile = path.join(__dirname, "data", "pricingSimulation.json");
const referenceCatalogFile = path.join(__dirname, "data", "referenceCatalog.json");
const estimatedPriceHistoryFile = path.join(__dirname, "..", "frontend", "data", "estimated-price-history.json");
const trackedMarketCardsFile = path.join(__dirname, "data", "trackedMarketCards.json");
const marketObservationsFile = path.join(
    __dirname,
    "data",
    "marketObservations.json"
);


const splitOutputFiles = {
    cards: path.join(outputDir, "cards.json"),
    watchlist: path.join(outputDir, "watchlist.json"),
    opportunities: path.join(outputDir, "opportunities.json"),
    cardDetails: path.join(outputDir, "card-details.json"),
    portfolioSummary: path.join(outputDir, "portfolio-summary.json"),
    portfolioHistory: path.join(outputDir, "portfolio-history.json"),
    categorySummary: path.join(outputDir, "category-summary.json"),
    topMovers: path.join(outputDir, "top-movers.json"),
    investmentAnalysis: path.join(outputDir, "investment-analysis.json")
};

function writeJson(file, data) {
    fs.writeFileSync(file, JSON.stringify(data, null, 2), "utf8");
}
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

function readTrackedMarketCards() {
    if (!fs.existsSync(trackedMarketCardsFile)) return [];
    return JSON.parse(fs.readFileSync(trackedMarketCardsFile, "utf8"));
}
function readMarketObservations() {
    if (!fs.existsSync(marketObservationsFile)) {
        return [];
    }

    const data = JSON.parse(
        fs.readFileSync(marketObservationsFile, "utf8")
    );

    return Array.isArray(data) ? data : [];
}

function normalizeKey(value) {
    return String(value || "")
        .trim()
        .toLowerCase()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "");
}

function watchlistKey(card) {
    return [
        normalizeKey(card.nomCarte),
        normalizeKey(card.edition),
        normalizeKey(card.version),
        normalizeKey(card.langue)
    ].join("|");
}
function observationCardKey(card) {
    return [
        normalizeKey(card.nomCarte),
        normalizeKey(card.edition),
        normalizeKey(card.langue)
    ].join("|");
}

function buildObservedPricesByCard(observations) {
    const grouped = new Map();

    observations.forEach(observation => {
        const key = observationCardKey(observation);

        const condition = String(
            observation.condition ||
            observation.etat ||
            ""
        ).toUpperCase();

        const price = Number(
            observation.observedMinPrice || 0
        );

        const date = String(
            observation.observationDate ||
            observation.date ||
            observation.createdAt ||
            ""
        ).slice(0, 10);

        if (
            !key ||
            !condition ||
            !Number.isFinite(price) ||
            price <= 0
        ) {
            return;
        }

        if (!grouped.has(key)) {
            grouped.set(key, {});
        }

        const conditionMap = grouped.get(key);
        const current = conditionMap[condition];

        /*
         * On retient la saisie la plus récente pour représenter
         * le prix de marché actuel de cet état.
         */
        if (
            !current ||
            date > current.date ||
            (
                date === current.date &&
                price < current.price
            )
        ) {
            conditionMap[condition] = {
                price,
                date
            };
        }
    });

    return grouped;
}

function buildWatchlistCards(collectionCards, trackedCards) {
    const ownedKeys = new Set(collectionCards.map(watchlistKey));

    function findReferenceCard(card) {
        if (card.pricingModel === "fwb_revised_ratio") {
            return collectionCards.find(candidate =>
                normalizeKey(candidate.nomCarte) === normalizeKey(card.nomCarte) &&
                normalizeKey(candidate.edition) === normalizeKey("Revised") &&
                normalizeKey(candidate.langue) === normalizeKey("English")
            );
        }

        return null;
    }

    const trackedVirtualCards = trackedCards
        .filter(card => !ownedKeys.has(watchlistKey(card)))
        .map(card => {
            const referenceCard = findReferenceCard(card);

            return {
                ...card,

                id: card.id || `tracked-${card.cardmarketId || watchlistKey(card)}`,

                etat: card.etat || "NM",
                categorie: card.categorie || "Watchlist",

                quantityOwned: 0,
                owned: false,
                ownedLabel: "Non",
                ownedStates: "-",

                trendPrice: Number(card.trendPrice || referenceCard?.trendPrice || 0),
                avg1: Number(card.avg1 || referenceCard?.avg1 || 0),
                avg7: Number(card.avg7 || referenceCard?.avg7 || 0),
                avg30: Number(card.avg30 || referenceCard?.avg30 || 0),
                lowPrice: Number(card.lowPrice || referenceCard?.lowPrice || 0),
                avgPrice: Number(card.avgPrice || referenceCard?.avgPrice || 0),

                estimatedPrice: Number(card.estimatedPrice || referenceCard?.trendPrice || 0),
                pricingConfidence: referenceCard ? 25 : 0,
                referenceCardFound: Boolean(referenceCard),
                referenceSource: referenceCard
                    ? `${referenceCard.nomCarte} | ${referenceCard.edition} | ${referenceCard.langue}`
                    : null
            };
        });

    return [
        ...collectionCards.map(card => ({
            ...card,
            quantityOwned: card.quantityOwned || 1,
            owned: true,
            ownedLabel: "Oui"
        })),
        ...trackedVirtualCards
    ];
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

function getEstimatedPriceFromSnapshot(row, etat) {
    const condition = String(etat || "").toUpperCase();

    let estimatedByCondition = row.estimatedByCondition;

    if (typeof estimatedByCondition === "string") {
        try {
            estimatedByCondition = JSON.parse(estimatedByCondition);
        } catch {
            estimatedByCondition = null;
        }
    }

    if (estimatedByCondition && typeof estimatedByCondition === "object") {
        return Number(
            estimatedByCondition[condition] ??
            estimatedByCondition.NM ??
            row.estimatedConditionPrice ??
            row.estimatedPrice ??
            0
        );
    }

    return Number(
        row.estimatedConditionPrice ??
        row.estimatedPrice ??
        0
    );
}

function getPreviousSnapshot(historyRows, days) {
    if (!historyRows.length) return null;

    const filtered = historyRows.filter(
        row =>
            row.date &&
            String(row.date).slice(0, 10) >= MODEL_START_DATE
    );

    if (!filtered.length) {
        return null;
    }

    const latest = filtered[filtered.length - 1];

    const targetDate = new Date(latest.date);
    targetDate.setDate(targetDate.getDate() - days);

    return [...filtered]
        .reverse()
        .find(row => new Date(row.date) <= targetDate) || null;
}

function buildInvestmentAnalysis(cards, estimatedPriceHistory) {
    return groupByCardEditionEtat(cards)
        .map(card => {
            const historyRows = estimatedPriceHistory
                .filter(row => Number(row.cardId) === Number(card.id))
                .sort((a, b) => String(a.date).localeCompare(String(b.date)));

            const latestSnapshot = historyRows[historyRows.length - 1] || null;

            const currentEstimatedPrice = latestSnapshot
                ? getEstimatedPriceFromSnapshot(latestSnapshot, card.etat)
                : Number(getEstimatedConditionPrice(card) || 0);

            function buildPeriod(days) {
                const previous = getPreviousSnapshot(historyRows, days);

                const previousPrice = previous
                    ? getEstimatedPriceFromSnapshot(previous, card.etat)
                    : null;

                return {
                    price: previousPrice,
                    performance: calculatePerformance(
                        currentEstimatedPrice,
                        previousPrice
                    )
                };
            }

            const d7 = buildPeriod(7);
            const d30 = buildPeriod(30);
            const d60 = buildPeriod(60);
            const d180 = buildPeriod(180);
            const d365 = buildPeriod(365);

            return {
                id: card.id,
                nomCarte: card.nomCarte,
                edition: card.edition,
                langue: card.langue,
                etat: card.etat,
                version: card.version || null,
                quantity: card.quantity || 1,

                currentEstimatedPrice: Number(currentEstimatedPrice.toFixed(2)),
                lotValue: Number((currentEstimatedPrice * (card.quantity || 1)).toFixed(2)),

                price7d: d7.price,
                perf7d: d7.performance,

                price30d: d30.price,
                perf30d: d30.performance,

                price60d: d60.price,
                perf60d: d60.performance,

                price180d: d180.price,
                perf180d: d180.performance,

                price365d: d365.price,
                perf365d: d365.performance,

                confidence:
                    latestSnapshot?.gradeModelConfidence ??
                    latestSnapshot?.confidence ??
                    card.gradeModelConfidence ??
                    card.pricingConfidence ??
                    null,

                observationDaysCount:
                    latestSnapshot?.observationDaysCount ??
                    card.observationDaysCount ??
                    0,

                pricingModel:
                    latestSnapshot?.pricingModel ??
                    card.pricingModel ??
                    null,

                gradeModelSource:
                    latestSnapshot?.gradeModelSource ??
                    card.gradeModelSource ??
                    null
            };
        })
        .sort((a, b) => {
            const aScore =
                a.perf30d ??
                a.perf7d ??
                a.perf60d ??
                a.perf180d ??
                a.perf365d ??
                0;

            const bScore =
                b.perf30d ??
                b.perf7d ??
                b.perf60d ??
                b.perf180d ??
                b.perf365d ??
                0;

            return bScore - aScore;
        });
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
    const ownedCondition = String(card.etat || "").toUpperCase();

    const estimatedPriceForOwnedCondition =
        simulation?.estimatedByCondition?.[ownedCondition] ??
        simulation?.estimatedPrice ??
        null;

    return {
        ...card,

        estimatedPrice: estimatedPriceForOwnedCondition,
        baseEstimatedPrice: simulation?.estimatedPrice ?? null,

        estimatedByCondition: simulation?.estimatedByCondition || null,
        buyTargetByCondition: simulation?.buyTargetByCondition || null,
        ratioByCondition: simulation?.ratioByCondition || null,

        gradeModelConfidence: simulation?.gradeModelConfidence ?? null,
        gradeModelSource: simulation?.gradeModelSource || null,

        lastObservedMinByCondition:
    simulation?.lastObservedMinByCondition || null,

observedMinByCondition:
    simulation?.observedMinByCondition || null,

reliableObservedByCondition:
    simulation?.reliableObservedByCondition || null,

observationReliabilityByCondition:
    simulation?.observationReliabilityByCondition || null,

averageObservationReliability:
    simulation?.averageObservationReliability ?? null,

bayesianWeights:
    simulation?.bayesianWeights || null,

observationDaysCount:
    simulation?.observationDaysCount || 0,

observationRowsCount:
    simulation?.observationRowsCount || 0,

        pricingModel: simulation?.pricingModel ?? null,
        pricingConfidence:
            simulation?.gradeModelConfidence ??
            simulation?.confidence ??
            null,
        pricingRatio: simulation?.ratioUsed ?? null,
        pricingObservationCount: simulation?.observationCount ?? 0,
        marketAnchorPrice: simulation?.marketAnchorPrice ?? null,
        referenceMarketAnchorPrice: simulation?.referenceMarketAnchorPrice ?? null,
        marketReferenceType:
    simulation?.marketReferenceType ?? null,

marketReferenceRole:
    simulation?.marketReferenceRole ?? null,

usesExternalReference:
    simulation?.usesExternalReference ?? false,

referenceName:
    simulation?.referenceName ?? null,

referenceEdition:
    simulation?.referenceEdition ?? null,

referenceLanguage:
    simulation?.referenceLanguage ?? null,

referenceVersion:
    simulation?.referenceVersion ?? null,

referenceCardFound:
    simulation?.referenceCardFound ?? false
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

    function getEstimatedConditionPrice(card) {
    const condition = String(card.etat || "").toUpperCase();

    let estimatedByCondition = card.estimatedByCondition;

    if (typeof estimatedByCondition === "string") {
        try {
            estimatedByCondition = JSON.parse(estimatedByCondition);
        } catch {
            estimatedByCondition = null;
        }
    }

    if (
        estimatedByCondition &&
        typeof estimatedByCondition === "object"
    ) {
        return (
            estimatedByCondition[condition] ??
            estimatedByCondition.NM ??
            card.estimatedPrice ??
            card.prixEtat ??
            0
        );
    }

    return (
        estimatedByCondition ??
        card.estimatedPrice ??
        card.prixEtat ??
        0
    );
}

const estimatedTotalValue = cards.reduce(
    (sum, card) => sum + Number(getEstimatedConditionPrice(card) || 0),
    0
);
    const todayDate = new Date().toISOString().slice(0, 10);

function buildPortfolioHistoryFromEstimatedSnapshots(estimatedPriceHistory) {
    const latestByDateAndCard = new Map();

    estimatedPriceHistory.forEach((row, index) => {
        if (!row.date || !row.cardId) return;

        const key = `${row.date}|${row.cardId}`;

        latestByDateAndCard.set(key, {
            ...row,
            _index: index
        });
    });

    const byDate = new Map();

    [...latestByDateAndCard.values()].forEach(row => {
        const value = Number(
            row.estimatedConditionPrice ??
            row.estimatedPrice ??
            0
        );

        if (!byDate.has(row.date)) {
            byDate.set(row.date, 0);
        }

        byDate.set(row.date, byDate.get(row.date) + value);
    });

    return [...byDate.entries()]
        .map(([date, totalValue]) => ({
            date,
            totalValue: Number(totalValue.toFixed(2))
        }))
        .sort((a, b) => String(a.date).localeCompare(String(b.date)));
}

const portfolioHistoryFromSnapshots =
    buildPortfolioHistoryFromEstimatedSnapshots(estimatedPriceHistory);

const portfolioHistoryEstimated = [
    ...portfolioHistoryFromSnapshots.filter(row => row.date !== todayDate),
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

    // portfolioHistoryEstimated est déjà calculé plus haut

const latestHistory = portfolioHistoryEstimated[portfolioHistoryEstimated.length - 1];
const previousHistory = portfolioHistoryEstimated[portfolioHistoryEstimated.length - 2];

const today = Number(latestHistory?.totalValue || estimatedTotalValue || 0);
const yesterday = Number(previousHistory?.totalValue || today || 0);

const change = today - yesterday;
const changePct = yesterday > 0 ? (change / yesterday) * 100 : 0;

    const portfolioSummary = {
    today: Number(today.toFixed(2)),
    estimatedTotalValue: Number(today.toFixed(2)),
    yesterday: Number(yesterday.toFixed(2)),
    change: Number(change.toFixed(2)),
    changePct: Number(changePct.toFixed(2)),
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
                WHERE date >= '2026-07-12'
  AND date <= date('now', '-7 days')
                GROUP BY cardId
            ) x ON x.maxId = h.id
        ),

        d30 AS (
            SELECT h.*
            FROM card_price_history h
            JOIN (
                SELECT cardId, MAX(id) AS maxId
                FROM card_price_history
                WHERE date >= '2026-07-12'
  AND date <= date('now', '-30 days')
                GROUP BY cardId
            ) x ON x.maxId = h.id
        ),

        d90 AS (
            SELECT h.*
            FROM card_price_history h
            JOIN (
                SELECT cardId, MAX(id) AS maxId
                FROM card_price_history
                WHERE date >= '2026-07-12'
  AND date <= date('now', '-90 days')
                GROUP BY cardId
            ) x ON x.maxId = h.id
        ),

        d180 AS (
            SELECT h.*
            FROM card_price_history h
            JOIN (
                SELECT cardId, MAX(id) AS maxId
                FROM card_price_history
                WHERE date >= '2026-07-12'
  AND date <= date('now', '-180 days')
                GROUP BY cardId
            ) x ON x.maxId = h.id
        ),

        d365 AS (
            SELECT h.*
            FROM card_price_history h
            JOIN (
                SELECT cardId, MAX(id) AS maxId
                FROM card_price_history
                WHERE date >= '2026-07-12'
  AND date <= date('now', '-365 days')
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

    const investmentAnalysis = buildInvestmentAnalysis(
    cards,
    estimatedPriceHistory
);

    const trackedMarketCards =
    readTrackedMarketCards();

const marketObservations =
    readMarketObservations();

const observedPricesByCard =
    buildObservedPricesByCard(marketObservations);

const watchlistCards =
    buildWatchlistCards(cards, trackedMarketCards);

const opportunities = buildNmOpportunities(watchlistCards)
    .map(opportunity => {
        const key = observationCardKey(opportunity);

        const observedConditions =
            observedPricesByCard.get(key) || {};

        const sourceCard = watchlistCards.find(card =>
            observationCardKey(card) === key
        );

        const observedMinByCondition = {};

        ["NM", "EX", "GD", "LP", "PL", "PO"]
            .forEach(condition => {
                observedMinByCondition[condition] =
                    observedConditions[condition]?.price ??
                    sourceCard?.observedMinByCondition?.[condition] ??
                    null;
            });

        const observedExPrice =
            observedMinByCondition.EX ??
            null;

        const reliableExPrice =
            sourceCard?.reliableObservedByCondition?.EX ??
            observedExPrice ??
            null;

        return {
            ...opportunity,

            exPrice: reliableExPrice,
            observedExPrice,

            observedMinByCondition,

            reliableObservedByCondition:
                sourceCard?.reliableObservedByCondition ||
                observedMinByCondition,

            observationReliabilityByCondition:
                sourceCard?.observationReliabilityByCondition ||
                null,

            averageObservationReliability:
                sourceCard?.averageObservationReliability ??
                null
        };
    });
    const cardDetails = {};

    function buildEstimatedHistoryForCard(card, estimatedPriceHistory) {
    const condition = String(card.etat || "").toUpperCase();

    return estimatedPriceHistory
    .filter(row =>
        Number(row.cardId) === Number(card.id) &&
        row.date &&
        String(row.date).slice(0, 10) >= MODEL_START_DATE
    )
        .sort((a, b) => String(a.date).localeCompare(String(b.date)))
        .map(row => {
            let estimatedByCondition =
                row.estimatedByCondition ||
                null;

            if (typeof estimatedByCondition === "string") {
                try {
                    estimatedByCondition = JSON.parse(estimatedByCondition);
                } catch {
                    estimatedByCondition = null;
                }
            }

            const historicalEstimatedPrice =
                row.estimatedConditionPrice ??
                row.estimatedPrice ??
                null;

            const estimatedConditionPrice =
                historicalEstimatedPrice ??
                estimatedByCondition?.[condition] ??
                null;

            return {
                ...row,
                etat: card.etat,
                estimatedByCondition,
                estimatedConditionPrice,
                estimatedPrice: estimatedConditionPrice
            };
        });
}

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

        function perf(days) {
    const filteredHistory = history
        .filter(row =>
            row.date &&
            String(row.date).slice(0, 10) >= MODEL_START_DATE
        )
        .sort((a, b) =>
            String(a.date).localeCompare(String(b.date))
        );

    if (!filteredHistory.length) {
        return null;
    }

    const latestRow =
        filteredHistory[filteredHistory.length - 1];

    const targetDate = new Date(latestRow.date);
    targetDate.setDate(targetDate.getDate() - days);

    const previousRow = [...filteredHistory]
        .reverse()
        .find(row =>
            new Date(row.date) <= targetDate
        );

    if (!previousRow) {
        return null;
    }

    return calculatePerformance(
        Number(latestRow.trendPrice),
        Number(previousRow.trendPrice)
    );
}

        const estimatedHistory = buildEstimatedHistoryForCard(card, estimatedPriceHistory);

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
    


    const generatedAt = new Date().toISOString();


    
    // Ancien fichier conservé temporairement pour compatibilité
// Ancien fichier complet désactivé : trop gros pour GitHub Pages.
// Les données sont maintenant servies via les fichiers séparés.

// Nouveaux fichiers séparés
writeJson(splitOutputFiles.cards, {
    generatedAt,
    cards
});

writeJson(splitOutputFiles.watchlist, {
    generatedAt,
    watchlistCards
});

writeJson(splitOutputFiles.opportunities, {
    generatedAt,
    opportunities
});

writeJson(splitOutputFiles.cardDetails, {
    generatedAt,
    cardDetails
});

writeJson(splitOutputFiles.portfolioSummary, {
    generatedAt,
    portfolioSummary
});

writeJson(splitOutputFiles.portfolioHistory, {
    generatedAt,
    portfolioHistory: portfolioHistoryEstimated
});

writeJson(splitOutputFiles.categorySummary, {
    generatedAt,
    categorySummary
});

writeJson(splitOutputFiles.topMovers, {
    generatedAt,
    topMovers
});

writeJson(splitOutputFiles.investmentAnalysis, {
    generatedAt,
    investmentAnalysis
});

    console.log(`Exports JSON séparés générés dans : ${outputDir}`);
    console.log(`${cards.length} cartes exportées`);
    console.log(`${opportunities.length} opportunités NM calculées`);
    console.log(`Valeur estimée V2 : ${estimatedTotalValue.toFixed(2)} €`);
    console.log(`Confiance moyenne : ${averagePricingConfidence.toFixed(0)}%`);
    console.log(`${investmentAnalysis.length} lignes analyse investissement exportées`);

    db.close();
}

main().catch(error => {
    console.error(error);
    process.exit(1);
});