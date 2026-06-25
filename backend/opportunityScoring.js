const fs = require("fs");
const path = require("path");

const number = value => Number(value) || 0;

const historyAnalysisPath = path.join(
    __dirname,
    "..",
    "frontend",
    "data",
    "price-history-analysis.json"
);

function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
}

function round(value, digits = 1) {
    return Number((Number(value) || 0).toFixed(digits));
}

function pct(current, previous) {
    if (!current || !previous || previous <= 0) return 0;
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
        card.nomCarte || "",
        card.edition || "",
        card.version || "",
        card.langue || ""
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
        owned: card.quantityOwned > 0,
        ownedLabel: card.quantityOwned > 0 ? "Oui" : "Non",
        ownedStates: [...card.ownedStatesSet].filter(Boolean).join(", ")
    }));
}

function scoreTriangle(value, ideal, min, max, maxScore) {
    if (value <= min || value >= max) return 0;
    if (value === ideal) return maxScore;

    if (value < ideal) {
        return ((value - min) / (ideal - min)) * maxScore;
    }

    return ((max - value) / (max - ideal)) * maxScore;
}

function scoreRange(value, minGood, maxGood, minAcceptable, maxAcceptable, maxScore) {
    if (value >= minGood && value <= maxGood) return maxScore;

    if (value < minGood && value > minAcceptable) {
        return ((value - minAcceptable) / (minGood - minAcceptable)) * maxScore;
    }

    if (value > maxGood && value < maxAcceptable) {
        return ((maxAcceptable - value) / (maxAcceptable - maxGood)) * maxScore;
    }

    return 0;
}

function computeTrendQuality(trendVs30, historical, reasons, warnings) {
    let score = scoreTriangle(trendVs30, 14, 0, 55, 100);

    if (historical && historical.change30d !== null && historical.change30d !== undefined) {
        const historical30d = number(historical.change30d);

        if (historical30d > 5 && historical30d < 35) {
            score += 8;
            reasons.push("Historique 30j positif et encore raisonnable");
        }

        if (historical30d > 45) {
            score -= 18;
            warnings.push("Historique 30j déjà très avancé");
        }
    }

    score = clamp(score, 0, 100);

    if (score >= 75) {
        reasons.push("Tendance de prix saine");
    } else if (score >= 50) {
        reasons.push("Tendance positive mais imparfaite");
    } else {
        warnings.push("Tendance faible, trop avancée ou instable");
    }

    return round(score, 0);
}

function computeMomentumQuality(avg1, avg7, avg30, avg1Vs7, avg7Vs30, historical, reasons, warnings) {
    let score = 0;

    if (avg1 > avg7 && avg7 > avg30) {
        score += 45;
        reasons.push("Momentum propre : Avg1 > Avg7 > Avg30");
    } else if (avg7 > avg30) {
        score += 25;
        reasons.push("Momentum positif : Avg7 > Avg30");
    } else {
        warnings.push("Momentum insuffisant ou en ralentissement");
    }

    score += scoreRange(avg1Vs7, 2, 15, -10, 35, 35);

    if (avg1Vs7 > 35) {
        score -= 30;
        warnings.push("Accélération trop brutale : risque de spike");
    } else if (avg1Vs7 < 0) {
        score -= 15;
        warnings.push("Momentum court terme négatif");
    } else {
        reasons.push("Accélération court terme raisonnable (" + round(avg1Vs7) + " %)");
    }

    if (historical && historical.acceleration !== null && historical.acceleration !== undefined) {
        const acceleration = number(historical.acceleration);

        if (acceleration > 0 && acceleration < 12) {
            score += 10;
            reasons.push("Accélération historique positive");
        }

        if (acceleration > 20) {
            score -= 15;
            warnings.push("Accélération historique trop forte");
        }

        if (acceleration < -10) {
            score -= 10;
            warnings.push("Accélération historique négative");
        }
    }

    return round(clamp(score, 0, 100), 0);
}

function computeRemainingPotential(trendVs30, avg1Vs7, historical, reasons, warnings) {
    let score = 50;

    score += scoreTriangle(trendVs30, 12, 0, 45, 30);
    score += scoreRange(avg1Vs7, 1, 15, -8, 35, 20);

    if (historical) {
        const historyPoints = number(historical.historyPoints);
        const position90d = historical.position90dPct;
        const uptrendDays = number(historical.uptrendDays);
        const volatility = historical.volatility;

        if (historyPoints >= 10) {
            if (position90d !== null && position90d !== undefined) {
                const pos = number(position90d);

                if (pos >= 35 && pos <= 75) {
                    score += 15;
                    reasons.push("Position 90j équilibrée : pas encore au maximum historique récent");
                } else if (pos > 90) {
                    score -= 25;
                    warnings.push("Très proche du plus haut 90j : potentiel restant réduit");
                } else if (pos < 25) {
                    score -= 5;
                    warnings.push("Encore proche du bas 90j : signal à confirmer");
                }
            }

            if (uptrendDays >= 3 && uptrendDays <= 18) {
                score += 10;
                reasons.push("Hausse récente mais pas trop mature");
            } else if (uptrendDays > 30) {
                score -= 15;
                warnings.push("Hausse déjà longue : potentiel restant plus faible");
            }

            if (volatility !== null && volatility !== undefined) {
                const vol = number(volatility);

                if (vol <= 6) {
                    score += 8;
                    reasons.push("Volatilité historique faible");
                } else if (vol > 15) {
                    score -= 18;
                    warnings.push("Volatilité élevée : signal moins fiable");
                }
            }
        } else {
            warnings.push("Historique encore court : potentiel estimé avec prudence");
            score -= 8;
        }
    } else {
        warnings.push("Pas encore assez d'historique interne");
        score -= 10;
    }

    score = clamp(score, 0, 100);

    if (score >= 75) {
        reasons.push("Potentiel restant élevé");
    } else if (score >= 55) {
        reasons.push("Potentiel restant moyen");
    } else {
        warnings.push("Potentiel restant faible ou incertain");
    }

    return round(score, 0);
}

function computeRiskMultiplier(trendPrice, trendVs30, avg1Vs7, historical, quantityOwned, reasons, warnings) {
    let multiplier = 1;

    if (trendPrice < 5) {
        multiplier *= 0.88;
        warnings.push("Carte peu chère : signal moins fiable");
    } else {
        reasons.push("Prix NM significatif supérieur à 5 €");
    }

    if (trendVs30 > 50) {
        multiplier *= 0.75;
        warnings.push("Trend très élevé : risque d'arriver trop tard");
    }

    if (avg1Vs7 > 35) {
        multiplier *= 0.72;
        warnings.push("Spike court terme détecté");
    }

    if (quantityOwned >= 4) {
        multiplier *= 0.85;
        warnings.push("Déjà possédé en 4 exemplaires ou plus");
    }

    if (historical && historical.volatility !== null && historical.volatility !== undefined) {
        const volatility = number(historical.volatility);

        if (volatility > 15) {
            multiplier *= 0.78;
            warnings.push("Volatilité historique élevée");
        } else if (volatility <= 6) {
            multiplier *= 1.03;
        }
    }

    return round(clamp(multiplier, 0.45, 1.05), 2);
}

function computeBuyProbability(trendQuality, momentumQuality, remainingPotential, riskMultiplier) {
    const base =
        trendQuality * 0.30 +
        momentumQuality * 0.25 +
        remainingPotential * 0.35 +
        10;

    return round(clamp(base * riskMultiplier, 0, 95), 0);
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

    const historical = historyMap.get(cardKey(card));

    const reasons = [];
    const warnings = [];

    const trendQuality = computeTrendQuality(trendVs30, historical, reasons, warnings);
    const momentumQuality = computeMomentumQuality(avg1, avg7, avg30, avg1Vs7, avg7Vs30, historical, reasons, warnings);
    const remainingPotential = computeRemainingPotential(trendVs30, avg1Vs7, historical, reasons, warnings);
    const riskMultiplier = computeRiskMultiplier(trendPrice, trendVs30, avg1Vs7, historical, quantityOwned, reasons, warnings);

    const buyProbability = computeBuyProbability(
        trendQuality,
        momentumQuality,
        remainingPotential,
        riskMultiplier
    );

    let decision = "Ignorer";
    if (buyProbability >= 85) {
        decision = "🟢 Achat fort";
    } else if (buyProbability >= 75) {
        decision = "🟡 Achat intéressant";
    } else if (buyProbability >= 60) {
        decision = "👀 Surveillance";
    }

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

        trendVs30: round(trendVs30),
        avg7Vs30: round(avg7Vs30),
        avg1Vs7: round(avg1Vs7),

        trendQuality,
        momentumQuality,
        remainingPotential,
        riskMultiplier,
        buyProbability,

        convictionScore: buyProbability,
        decision,
        reasons,
        warnings,

        historical: historical || null
    };
}

function buildNmOpportunities(cards) {
    const historyMap = buildHistoryMap();

    return deduplicateNmOpportunities(cards)
        .filter(card =>
            number(card.trendPrice) > 0 &&
            number(card.avg30) > 0
        )
        .map(card => computeNmOpportunity(card, historyMap))
        .filter(card => card.buyProbability >= 55)
        .sort((a, b) => b.buyProbability - a.buyProbability);
}

function getEmailOpportunities(opportunities) {
    return opportunities
        .filter(card =>
            number(card.buyProbability) >= 85 &&
            number(card.remainingPotential) >= 65 &&
            number(card.riskMultiplier) >= 0.75
        )
        .sort((a, b) => b.buyProbability - a.buyProbability);
}

module.exports = {
    buildNmOpportunities,
    computeNmOpportunity,
    getEmailOpportunities
};