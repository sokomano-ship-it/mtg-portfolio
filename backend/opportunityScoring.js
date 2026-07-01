const isEligible = require("./scoring/eligibilityEngine");
const computeTrendQuality = require("./scoring/trendEngine");
const computeMomentumQuality = require("./scoring/momentumEngine");
const computeRemainingPotential = require("./scoring/potentialEngine");
const computeRiskMultiplier = require("./scoring/riskEngine");
const computeTimingScore = require("./scoring/timingEngine");
const {
    computeBuyProbability,
    getDecision
} = require("./scoring/probabilityEngine");
const buildExplanation = require("./scoring/explanationEngine");
const {
    buildHistoryMap,
    getHistoricalProfile
} = require("./history/historyEngine");
const { pct, round } = require("./scoring/utils");

function number(value) {
    return Number(value) || 0;
}

function cardIdentityKey(card) {
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
        const key = cardIdentityKey(card);
        const qty = number(card.quantityOwned);
        const isOwned = qty > 0 || card.owned === true;

        if (!map.has(key)) {
            map.set(key, {
                ...card,
                quantityOwned: isOwned ? Math.max(qty, 1) : 0,
                ownedStatesSet: new Set(isOwned && card.etat ? [card.etat] : [])
            });
        } else {
            const existing = map.get(key);

            if (isOwned) {
                existing.quantityOwned += Math.max(qty, 1);
                if (card.etat) {
                    existing.ownedStatesSet.add(card.etat);
                }
            }
        }
    });

    return [...map.values()].map(card => {
        const quantityOwned = number(card.quantityOwned);
        const owned = quantityOwned > 0;

        return {
            ...card,
            quantityOwned,
            owned,
            ownedLabel: owned ? "Oui" : "Non",
            ownedStates: owned
                ? [...card.ownedStatesSet].filter(Boolean).join(", ")
                : "-"
        };
    });
}

function computeNmOpportunity(card, historyMap) {
    const trendPrice = number(card.trendPrice);
    const nmTargetPrice = number(card.estimatedPrice || card.trendPrice);

const exRatio =
    number(card.exConditionRatio) ||
    number(card.conditionRatios?.EX) ||
    0.85;

const exTargetPrice = nmTargetPrice * exRatio;
const exDiscountPct = nmTargetPrice > 0
    ? ((exTargetPrice / nmTargetPrice) - 1) * 100
    : 0;
    const avg1 = number(card.avg1);
    const avg7 = number(card.avg7);
    const avg30 = number(card.avg30);
    const quantityOwned = number(card.quantityOwned);

    const trendVs30 = pct(trendPrice, avg30);
    const avg7Vs30 = pct(avg7, avg30);
    const avg1Vs7 = pct(avg1, avg7);

    const historical = getHistoricalProfile(card, historyMap);

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

    const timingScore = computeTimingScore(
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
        timingScore,
        riskMultiplier
    );

    const decision = getDecision(buyProbability, timingScore);
    const explanation = buildExplanation(reasons, warnings);

    return {
        ...card,

        quantityOwned,
        owned: quantityOwned > 0,
        ownedLabel: quantityOwned > 0 ? "Oui" : "Non",
        ownedStates: card.ownedStates || "-",

        nmPrice: round(trendPrice, 2),
        trendPrice: round(trendPrice, 2),
        nmTargetPrice: round(nmTargetPrice, 2),
exTargetPrice: round(exTargetPrice, 2),
exDiscountPct: round(exDiscountPct, 2),
        avg1: round(avg1, 2),
        avg7: round(avg7, 2),
        avg30: round(avg30, 2),

        trendVs30: round(trendVs30, 2),
        avg7Vs30: round(avg7Vs30, 2),
        avg1Vs7: round(avg1Vs7, 2),

        trendQuality,
        momentumQuality,
        remainingPotential,
        timingScore,
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
            number(card.timingScore) >= 80 &&
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