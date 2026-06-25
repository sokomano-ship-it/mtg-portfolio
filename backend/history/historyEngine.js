const fs = require("fs");
const path = require("path");

const historyFile = path.join(
    __dirname,
    "..",
    "..",
    "frontend",
    "data",
    "price-history-snapshots.json"
);

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

function cardKey(card) {
    return [
        card.cardmarketId || "",
        String(card.nomCarte || "").trim().toLowerCase(),
        String(card.edition || "").trim().toLowerCase(),
        String(card.version || "").trim().toLowerCase(),
        String(card.langue || "").trim().toLowerCase()
    ].join("|");
}

function buildHistoryMap() {
    const rows = loadJson(historyFile, []);
    const map = new Map();

    rows.forEach(row => {
        const key = cardKey(row);

        if (!map.has(key)) {
            map.set(key, []);
        }

        map.get(key).push(row);
    });

    for (const [key, values] of map.entries()) {
        values.sort((a, b) => new Date(a.date) - new Date(b.date));
        map.set(key, values);
    }

    return map;
}

function daysBetween(dateA, dateB) {
    const a = new Date(dateA);
    const b = new Date(dateB);
    return Math.round((b - a) / (1000 * 60 * 60 * 24));
}

function dailyChanges(rows) {
    const changes = [];

    for (let i = 1; i < rows.length; i++) {
        const previous = number(rows[i - 1].trendPrice);
        const current = number(rows[i].trendPrice);
        const change = pct(current, previous);

        if (change !== null) {
            changes.push(change);
        }
    }

    return changes;
}

function standardDeviation(values) {
    if (!values.length) return null;

    const avg = values.reduce((sum, value) => sum + value, 0) / values.length;

    const variance =
        values.reduce((sum, value) => {
            return sum + Math.pow(value - avg, 2);
        }, 0) / values.length;

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

function computePositiveDaysRatio(rows) {
    const changes = dailyChanges(rows);

    if (!changes.length) return null;

    const positiveDays = changes.filter(change => change >= 0).length;

    return (positiveDays / changes.length) * 100;
}

function computeSlope(rows) {
    if (rows.length < 2) return null;

    const first = rows[0];
    const last = rows[rows.length - 1];

    const change = pct(number(last.trendPrice), number(first.trendPrice));
    const days = Math.max(1, daysBetween(first.date, last.date));

    if (change === null) return null;

    return change / days;
}

function computeAcceleration(rows) {
    if (rows.length < 6) return null;

    const recent = rows.slice(-3);
    const previous = rows.slice(-6, -3);

    const recentSlope = computeSlope(recent);
    const previousSlope = computeSlope(previous);

    if (recentSlope === null || previousSlope === null) return null;

    return recentSlope - previousSlope;
}

function computeRangePosition(rows, latestPrice) {
    const prices = rows
        .map(row => number(row.trendPrice))
        .filter(price => price > 0);

    if (prices.length < 2 || latestPrice <= 0) {
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

function analyzeRows(rows) {
    if (!rows || !rows.length) {
        return null;
    }

    const sorted = [...rows].sort((a, b) => new Date(a.date) - new Date(b.date));
    const latest = sorted[sorted.length - 1];
    const latestPrice = number(latest.trendPrice);
    const latestDate = latest.date;

    const last30 = sorted.filter(row => daysBetween(row.date, latestDate) <= 30);
    const last90 = sorted.filter(row => daysBetween(row.date, latestDate) <= 90);

    const changes30 = dailyChanges(last30);
    const volatility30 = standardDeviation(changes30);

    const range30 = computeRangePosition(last30, latestPrice);
    const range90 = computeRangePosition(last90, latestPrice);

    return {
        historyPoints: sorted.length,
        firstDate: sorted[0].date,
        latestDate,
        latestTrendPrice: round(latestPrice, 2),

        historyAgeDays: daysBetween(sorted[0].date, latestDate),
        uptrendDays: computeUptrendDays(sorted),

        positiveDaysRatio30: computePositiveDaysRatio(last30) === null
            ? null
            : round(computePositiveDaysRatio(last30), 1),

        slope30PerDay: computeSlope(last30) === null
            ? null
            : round(computeSlope(last30), 3),

        acceleration: computeAcceleration(sorted) === null
            ? null
            : round(computeAcceleration(sorted), 3),

        volatility30: volatility30 === null ? null : round(volatility30, 2),

        high30d: range30.high === null ? null : round(range30.high, 2),
        low30d: range30.low === null ? null : round(range30.low, 2),
        position30dPct: range30.positionPct === null ? null : round(range30.positionPct, 1),

        high90d: range90.high === null ? null : round(range90.high, 2),
        low90d: range90.low === null ? null : round(range90.low, 2),
        position90dPct: range90.positionPct === null ? null : round(range90.positionPct, 1)
    };
}

function getHistoricalProfile(card, historyMap) {
    const rows = historyMap.get(cardKey(card));

    if (!rows || !rows.length) {
        return null;
    }

    return analyzeRows(rows);
}

module.exports = {
    buildHistoryMap,
    getHistoricalProfile,
    analyzeRows
};