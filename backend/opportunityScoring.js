const fs = require("fs");
const path = require("path");

const isEligible = require("./scoring/eligibilityEngine");
const computeTrendQuality = require("./scoring/trendEngine");
const computeMomentumQuality = require("./scoring/momentumEngine");
const computeRemainingPotential = require("./scoring/potentialEngine");
const computeRiskMultiplier = require("./scoring/riskEngine");
const {
    computeBuyProbability,
    getDecision
} = require("./scoring/probabilityEngine");
const buildExplanation = require("./scoring/explanationEngine");
const { pct, round } = require("./scoring/utils");

const historyAnalysisPath = path.join(
    __dirname,
    "..",
    "frontend",
    "data",
    "price-history-analysis.json"
);

function number(value) {
    return Number(value) || 0;
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
    const history = loadJson(historyAnalysisPath, []);
    const map = new Map();

    history.forEach(row => {
        map.set(cardKey(row), row);
    });

    return map;
}

function opportunityKey(card) {
    return [
        card.nomCarte || "",
        card.edition || "",
        card.version || "",
        card.langue || ""
    ].join("|");
}

function deduplicateNmOpportunities(cards) {
    const map = new Map();

    cards.forEach(card => {
        const key = opportunityKey(card);

        if (!map.has(key)) {
            map.set(key, {
                ...card,
                quantityOwned: 1,
                ownedStatesSet: new Set([card.etat || ""])
            });
        } else {
            const existing = map.get(key);
            existing.quantityOwned += 1;
            existing.ownedStatesSet.add(card.etat || "");
        }
    });

    return [...map.values()].map(card => ({
        ...card,
        quantityOwned: number(card.quantityOwned),
        owned: number(card.quantityOwned) > 0,
        ownedLabel: number(card.quantityOwned) > 0 ? "Oui" : "Non",
        ownedStates: [...card.ownedStatesSet].filter(Boolean).join(", ")
    }));
}

function computeNmOpportunity(card, historyMap) {
    const trendPrice = number(card.trendPrice);
    const avg1 = number(card.avg1);
    const avg7 = number(card.avg7);
    const avg30 = number(card.avg30);
    const quantityOwned = number(card.quantityOwned);

    const trendVs30 = pct(trendPrice, avg30);
    const avg7Vs30 = pct(avg7, avg30);
    const avg1Vs7 = pct(avg1, avg7);

    const historical = historyMap.get(cardKey(card)) || null;

    const reasons = [];
    const warnings = [];

    const trendQuality = computeTrendQuality(
        trendVs30,
        historical,
        reasons,
        warnings
    );

    const momentumQuality = computeMomentumQuality(
        avg1,
        avg7,
        avg30,
        avg1Vs7,
        reasons,
        warnings
    );

    const remainingPotential = computeRemainingPotential(
        trendVs30,
        avg1Vs7,
        historical,
        reasons,
        warnings
    );

    const riskMultiplier = computeRiskMultiplier(
        trendPrice,
        trendVs30,
        avg1Vs7,
        historical,
        quantityOwned,
        reasons,
        warnings
    );

    const buyProbability = computeBuyProbability(
        trendQuality,
        momentumQuality,
        remainingPotential,
        riskMultiplier
    );

    const decision = getDecision(buyProbability);
    const explanation = buildExplanation(reasons, warnings);

    return {
        ...card,

        quantityOwned,
        owned: quantityOwned > 0,
        ownedLabel: quantityOwned > 0 ? "Oui" : "Non",
        ownedStates: card.ownedStates || "-",

        nmPrice: round(trendPrice, 2),
        trendPrice: round(trendPrice, 2),
        avg1: round(avg1, 2),
        avg7: round(avg7, 2),
        avg30: round(avg30, 2),

        trendVs30: round(trendVs30, 2),
        avg7Vs30: round(avg7Vs30, 2),
        avg1Vs7: round(avg1Vs7, 2),

        trendQuality,
        momentumQuality,
        remainingPotential,
        riskMultiplier,
        buyProbability,

        convictionScore: buyProbability,
        decision,

        reasons,
        warnings,
        explanation,
        historical
    };
}

function buildNmOpportunities(cards) {
    const historyMap = buildHistoryMap();

    return deduplicateNmOpportunities(cards)
        .filter(isEligible)
        .map(card => computeNmOpportunity(card, historyMap))
        .filter(card => number(card.buyProbability) >= 55)
        .sort((a, b) =>
            number(b.buyProbability) - number(a.buyProbability)
        );
}

function getEmailOpportunities(opportunities) {
    return opportunities
        .filter(card =>
            number(card.buyProbability) >= 85 &&
            number(card.remainingPotential) >= 65 &&
            number(card.riskMultiplier) >= 0.75
        )
        .sort((a, b) =>
            number(b.buyProbability) - number(a.buyProbability)
        );
}

module.exports = {
    buildNmOpportunities,
    computeNmOpportunity,
    getEmailOpportunities
};