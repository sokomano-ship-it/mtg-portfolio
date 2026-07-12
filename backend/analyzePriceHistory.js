const fs = require("fs");
const path = require("path");

const inputFile = path.join(__dirname, "..", "frontend", "data", "price-history-snapshots.json");
const outputFile = path.join(__dirname, "..", "frontend", "data", "price-history-analysis.json");
const MODEL_START_DATE = "2026-07-12";

function number(value) {
    return Number(value) || 0;
}

function round(value, digits = 2) {
    return Number((Number(value) || 0).toFixed(digits));
}

function pct(current, previous) {
    if (!current || !previous || previous <= 0) return null;
    return ((current - previous) / previous) * 100;
}

function loadJson(filePath, fallback) {
    if (!fs.existsSync(filePath)) return fallback;

    try {
        return JSON.parse(fs.readFileSync(filePath, "utf8"));
    } catch {
        return fallback;
    }
}

function saveJson(filePath, data) {
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), "utf8");
}

function cardKey(row) {
    return [
        row.cardmarketId || "",
        row.nomCarte || "",
        row.edition || "",
        row.version || "",
        row.langue || ""
    ].join("|");
}

function daysBetween(dateA, dateB) {
    const a = new Date(dateA);
    const b = new Date(dateB);
    return Math.round((b - a) / (1000 * 60 * 60 * 24));
}

function findSnapshotAtLeastDaysAgo(rows, latestDate, daysAgo) {
    const target = new Date(latestDate);
    target.setDate(target.getDate() - daysAgo);

    return [...rows]
        .reverse()
        .find(row => new Date(row.date) <= target);
}

function computeVolatility(rows) {
    if (rows.length < 3) return null;

    const changes = [];

    for (let i = 1; i < rows.length; i++) {
        const previous = number(rows[i - 1].trendPrice);
        const current = number(rows[i].trendPrice);
        const change = pct(current, previous);

        if (change !== null) {
            changes.push(change);
        }
    }

    if (changes.length < 2) return null;

    const average = changes.reduce((sum, value) => sum + value, 0) / changes.length;

    const variance =
        changes.reduce((sum, value) => {
            return sum + Math.pow(value - average, 2);
        }, 0) / changes.length;

    return Math.sqrt(variance);
}

function computeUptrendDays(rows) {
    if (rows.length < 2) return 0;

    let count = 0;

    for (let i = rows.length - 1; i > 0; i--) {
        const current = number(rows[i].trendPrice);
        const previous = number(rows[i - 1].trendPrice);

        if (current >= previous) {
            count += 1;
        } else {
            break;
        }
    }

    return count;
}

function computeAcceleration(rows) {
    if (rows.length < 5) return null;

    const recent = rows.slice(-3);
    const previous = rows.slice(-6, -3);

    if (recent.length < 3 || previous.length < 2) return null;

    const recentStart = number(recent[0].trendPrice);
    const recentEnd = number(recent[recent.length - 1].trendPrice);

    const previousStart = number(previous[0].trendPrice);
    const previousEnd = number(previous[previous.length - 1].trendPrice);

    const recentChange = pct(recentEnd, recentStart);
    const previousChange = pct(previousEnd, previousStart);

    if (recentChange === null || previousChange === null) return null;

    return recentChange - previousChange;
}

function computeHighLowPosition(rows, latestPrice) {
    if (rows.length < 2 || !latestPrice) {
        return {
            high: null,
            low: null,
            positionPct: null
        };
    }

    const prices = rows
        .map(row => number(row.trendPrice))
        .filter(price => price > 0);

    if (!prices.length) {
        return {
            high: null,
            low: null,
            positionPct: null
        };
    }

    const high = Math.max(...prices);
    const low = Math.min(...prices);

    if (high === low) {
        return {
            high,
            low,
            positionPct: 100
        };
    }

    return {
        high,
        low,
        positionPct: ((latestPrice - low) / (high - low)) * 100
    };
}

function classifyTrend(change30d, uptrendDays, volatility) {
    if (change30d === null) return "Historique insuffisant";

    if (change30d > 25 && volatility !== null && volatility > 12) {
        return "Spike volatil";
    }

    if (change30d > 15 && uptrendDays >= 5) {
        return "Hausse confirmée";
    }

    if (change30d > 5) {
        return "Hausse progressive";
    }

    if (change30d < -10) {
        return "Correction";
    }

    return "Stable";
}

function analyzeCard(rows) {
    const sorted = [...rows]
    .filter(row =>
        row.date &&
        String(row.date).slice(0, 10) >= MODEL_START_DATE
    )
    .sort((a, b) => new Date(a.date) - new Date(b.date));

if (!sorted.length) {
    return null;
}

    const latest = sorted[sorted.length - 1];
    const latestDate = latest.date;
    const latestPrice = number(latest.trendPrice);

    const d7 = findSnapshotAtLeastDaysAgo(sorted, latestDate, 7);
    const d30 = findSnapshotAtLeastDaysAgo(sorted, latestDate, 30);
    const d90 = findSnapshotAtLeastDaysAgo(sorted, latestDate, 90);

    const change7d = d7 ? pct(latestPrice, number(d7.trendPrice)) : null;
    const change30d = d30 ? pct(latestPrice, number(d30.trendPrice)) : null;
    const change90d = d90 ? pct(latestPrice, number(d90.trendPrice)) : null;

    const ageDays = daysBetween(sorted[0].date, latestDate);
    const uptrendDays = computeUptrendDays(sorted);
    const volatility = computeVolatility(sorted);
    const acceleration = computeAcceleration(sorted);

    const last90Rows = sorted.filter(row => {
        return daysBetween(row.date, latestDate) <= 90;
    });

    const highLow = computeHighLowPosition(last90Rows, latestPrice);

    return {
        cardmarketId: latest.cardmarketId,
        nomCarte: latest.nomCarte,
        edition: latest.edition,
        version: latest.version || "",
        langue: latest.langue || "",

        latestDate,
        historyPoints: sorted.length,
        historyAgeDays: ageDays,

        latestTrendPrice: round(latestPrice, 2),

        change7d: change7d === null ? null : round(change7d, 2),
        change30d: change30d === null ? null : round(change30d, 2),
        change90d: change90d === null ? null : round(change90d, 2),

        uptrendDays,
        volatility: volatility === null ? null : round(volatility, 2),
        acceleration: acceleration === null ? null : round(acceleration, 2),

        high90d: highLow.high === null ? null : round(highLow.high, 2),
        low90d: highLow.low === null ? null : round(highLow.low, 2),
        position90dPct: highLow.positionPct === null ? null : round(highLow.positionPct, 1),

        trendClassification: classifyTrend(change30d, uptrendDays, volatility)
    };
}

function main() {
    const history = loadJson(inputFile, []);

    if (!history.length) {
        saveJson(outputFile, []);
        console.log("Aucun historique disponible.");
        return;
    }

    const grouped = new Map();

    history.forEach(row => {
        const key = cardKey(row);

        if (!grouped.has(key)) {
            grouped.set(key, []);
        }

        grouped.get(key).push(row);
    });

    const analysis = [...grouped.values()]
    .map(analyzeCard)
    .filter(Boolean)
    .sort((a, b) => {
        return number(b.change30d) - number(a.change30d);
    });

    saveJson(outputFile, analysis);

    console.log(`${analysis.length} carte(s) analysée(s) depuis l'historique prix.`);
}

main();