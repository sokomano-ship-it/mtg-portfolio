const number = value => Number(value) || 0;

function pct(current, previous) {
    if (!current || !previous || previous <= 0) return 0;
    return ((current - previous) / previous) * 100;
}

function round(value, digits = 1) {
    return Number((Number(value) || 0).toFixed(digits));
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

    let convictionScore = 0;
    const reasons = [];
    const warnings = [];

    if (trendPrice >= 5) {
        convictionScore += 10;
        reasons.push("Prix NM significatif supérieur à 5 €");
    } else {
        convictionScore -= 15;
        warnings.push("Carte peu chère : signal moins fiable");
    }

    if (trendVs30 >= 8 && trendVs30 <= 40) {
        convictionScore += 25;
        reasons.push(
            "Trend NM supérieur à la moyenne 30j (" + round(trendVs30) + " %)"
        );
    } else if (trendVs30 > 50) {
        convictionScore -= 20;
        warnings.push("Hausse déjà très forte : risque de spike tardif");
    }

    if (avg1 > avg7 && avg7 > avg30) {
        convictionScore += 25;
        reasons.push("Momentum propre : Avg1 > Avg7 > Avg30");
    } else if (avg7 > avg30) {
        convictionScore += 12;
        reasons.push("Momentum positif : Avg7 > Avg30");
    }

    if (avg7Vs30 >= 4 && avg7Vs30 <= 30) {
        convictionScore += 15;
        reasons.push(
            "Hausse récente progressive (" + round(avg7Vs30) + " %)"
        );
    }

    if (avg1Vs7 >= 1 && avg1Vs7 <= 25) {
        convictionScore += 10;
        reasons.push(
            "Accélération court terme raisonnable (" + round(avg1Vs7) + " %)"
        );
    } else if (avg1Vs7 > 35) {
        convictionScore -= 15;
        warnings.push("Accélération trop brutale : risque de correction");
    }

    if (quantityOwned >= 4) {
    convictionScore -= 35;
    warnings.push("Déjà possédé en 4 exemplaires ou plus");
}

    convictionScore = Math.max(0, Math.min(100, round(convictionScore, 0)));

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

        convictionScore,
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