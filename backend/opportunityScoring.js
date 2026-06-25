const number = value => Number(value) || 0;

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

function computeNmOpportunity(card) {
    const trendPrice = number(card.trendPrice);
    const avg1 = number(card.avg1);
    const avg7 = number(card.avg7);
    const avg30 = number(card.avg30);
    const quantityOwned = number(card.quantityOwned);

    const trendVs30 = pct(trendPrice, avg30);
    const avg7Vs30 = pct(avg7, avg30);
    const avg1Vs7 = pct(avg1, avg7);

    const reasons = [];
    const warnings = [];

    const trendScore = round(
        scoreTriangle(trendVs30, 15, 0, 55, 25),
        1
    );

    if (trendScore >= 20) {
        reasons.push("Tendance saine : Trend NM supérieur à Avg30 de " + round(trendVs30) + " %");
    } else if (trendScore >= 10) {
        reasons.push("Tendance positive mais moins idéale : " + round(trendVs30) + " % vs Avg30");
    } else {
        warnings.push("Tendance faible ou déjà trop avancée : " + round(trendVs30) + " % vs Avg30");
    }

    const momentumShapeScore = scoreRange(
        avg1Vs7,
        2,
        15,
        -10,
        35,
        18
    );

    const momentumStructureScore =
        avg1 > avg7 && avg7 > avg30 ? 12 :
        avg7 > avg30 ? 7 :
        0;

    const momentumScore = round(
        clamp(momentumShapeScore + momentumStructureScore, 0, 30),
        1
    );

    if (avg1 > avg7 && avg7 > avg30) {
        reasons.push("Momentum propre : Avg1 > Avg7 > Avg30");
    } else if (avg7 > avg30) {
        reasons.push("Momentum positif : Avg7 > Avg30");
    } else {
        warnings.push("Momentum insuffisant ou en ralentissement");
    }

    if (avg1Vs7 > 35) {
        warnings.push("Accélération trop brutale : risque de correction");
    } else if (avg1Vs7 < 0) {
        warnings.push("Momentum court terme négatif : Avg1 < Avg7");
    } else {
        reasons.push("Accélération court terme raisonnable (" + round(avg1Vs7) + " %)");
    }

    const potentialScore = round(
        scoreTriangle(trendVs30, 12, 0, 45, 25) *
        scoreRange(avg1Vs7, 1, 15, -8, 35, 1),
        1
    );

    if (potentialScore >= 20) {
        reasons.push("Potentiel restant élevé : hausse encore progressive");
    } else if (potentialScore >= 10) {
        reasons.push("Potentiel restant moyen : hausse déjà visible");
    } else {
        warnings.push("Potentiel restant faible : hausse probablement déjà avancée");
    }

    let riskScore = 20;

    if (trendPrice < 5) {
        riskScore -= 8;
        warnings.push("Carte peu chère : signal moins fiable");
    } else {
        reasons.push("Prix NM significatif supérieur à 5 €");
    }

    if (trendVs30 > 50) {
        riskScore -= 8;
        warnings.push("Trend très élevé : risque d'arriver tard");
    }

    if (avg1Vs7 > 35) {
        riskScore -= 8;
        warnings.push("Spike court terme détecté");
    }

    if (quantityOwned >= 4) {
        riskScore -= 12;
        warnings.push("Déjà possédé en 4 exemplaires ou plus");
    }

    riskScore = round(clamp(riskScore, 0, 20), 1);

    const convictionScore = round(
        clamp(trendScore + momentumScore + potentialScore + riskScore, 0, 100),
        0
    );

    let decision = "Ignorer";
    if (convictionScore >= 85) {
        decision = "🟢 Achat fort";
    } else if (convictionScore >= 75) {
        decision = "🟡 Achat intéressant";
    } else if (convictionScore >= 60) {
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

        trendScore,
        momentumScore,
        potentialScore,
        riskScore,
        convictionScore,
        decision,

        reasons,
        warnings
    };
}

function buildNmOpportunities(cards) {
    return deduplicateNmOpportunities(cards)
        .filter(card =>
            number(card.trendPrice) > 0 &&
            number(card.avg30) > 0
        )
        .map(computeNmOpportunity)
        .filter(card => card.convictionScore >= 60)
        .sort((a, b) => b.convictionScore - a.convictionScore);
}

function getEmailOpportunities(opportunities) {
    return opportunities
        .filter(card => number(card.convictionScore) >= 85)
        .sort((a, b) => b.convictionScore - a.convictionScore);
}

module.exports = {
    buildNmOpportunities,
    computeNmOpportunity,
    getEmailOpportunities
};