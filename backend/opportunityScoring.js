function number(value) {
    return Number(value) || 0;
}

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
                ownedStates: new Set([card.etat || ""])
            });
        } else {
            const existing = map.get(key);
            existing.quantityOwned += 1;
            existing.ownedStates.add(card.etat || "");
        }
    });

    return [...map.values()].map(card => ({
        ...card,
        ownedStates: [...card.ownedStates].filter(Boolean).join(", ")
    }));
}

function computeNmOpportunity(card) {
    const trendPrice = number(card.trendPrice);
    const lowPrice = number(card.lowPrice);
    const avgPrice = number(card.avgPrice);
    const avg1 = number(card.avg1);
    const avg7 = number(card.avg7);
    const avg30 = number(card.avg30);

    const trendVs30 = pct(trendPrice, avg30);
    const avg7Vs30 = pct(avg7, avg30);
    const avg1Vs7 = pct(avg1, avg7);
    const lowDiscount = trendPrice > 0 && lowPrice > 0
        ? ((trendPrice - lowPrice) / trendPrice) * 100
        : 0;

    let marketScore =
        trendVs30 * 0.35 +
        avg7Vs30 * 0.30 +
        avg1Vs7 * 0.25 +
        lowDiscount * 0.10;

    let convictionScore = 0;
    const reasons = [];

    if (trendPrice >= 5) {
        convictionScore += 10;
        reasons.push("Prix NM significatif > 5 €");
    }

    if (trendVs30 >= 10 && trendVs30 <= 35) {
        convictionScore += 20;
        reasons.push(`Trend NM supérieur à la moyenne 30j (${round(trendVs30)} %)`);
    }

    if (avg1 > avg7 && avg7 > avg30) {
        convictionScore += 25;
        reasons.push("Momentum propre : Avg1 > Avg7 > Avg30");
    }

    if (avg7Vs30 >= 5 && avg7Vs30 <= 25) {
        convictionScore += 15;
        reasons.push(`Hausse récente progressive (${round(avg7Vs30)} %)`);
    }

    if (avg1Vs7 >= 2 && avg1Vs7 <= 20) {
        convictionScore += 10;
        reasons.push(`Accélération court terme raisonnable (${round(avg1Vs7)} %)`);
    }

    if (lowPrice > 0 && lowDiscount >= 5 && lowDiscount <= 25) {
        convictionScore += 10;
        reasons.push(`Low NM intéressant (${round(lowDiscount)} % sous le trend)`);
    }

    if (trendVs30 > 50) {
        convictionScore -= 25;
        reasons.push("Pénalité : hausse déjà trop violente");
    }

    if (avg1Vs7 > 35) {
        convictionScore -= 15;
        reasons.push("Pénalité : spike court terme trop brutal");
    }

    if (trendPrice < 2) {
        convictionScore -= 20;
        reasons.push("Pénalité : carte trop peu chère");
    }

    convictionScore = Math.max(0, Math.min(100, round(convictionScore, 0)));

    let recommendation = "Ignorer";
    let signal = "Neutre";

    if (convictionScore >= 90) {
        recommendation = "⭐ Achat fort";
        signal = "🔥 Conviction achat NM";
    } else if (convictionScore >= 85) {
        recommendation = "👍 Achat intéressant";
        signal = "📈 Achat sélectif NM";
    } else if (convictionScore >= 75) {
        recommendation = "👀 Surveillance";
        signal = "👀 À surveiller";
    }

    return {
        ...card,
        quantityOwned: number(card.quantityOwned) || 1,
        ownedStates: card.ownedStates || card.etat || "-",

        nmPrice: round(trendPrice, 2),
        trendPrice: round(trendPrice, 2),
        lowPrice: round(lowPrice, 2),
        avgPrice: round(avgPrice, 2),
        avg1: round(avg1, 2),
        avg7: round(avg7, 2),
        avg30: round(avg30, 2),

        trendVs30: round(trendVs30),
        avg7Vs30: round(avg7Vs30),
        avg1Vs7: round(avg1Vs7),
        lowDiscount: round(lowDiscount),

        score: round(marketScore),
        convictionScore,
        recommendation,
        signal,
        reasons
    };
}

function buildNmOpportunities(cards) {
    return deduplicateNmOpportunities(cards)
        .filter(card =>
            number(card.trendPrice) > 0 &&
            number(card.avg30) > 0
        )
        .map(computeNmOpportunity)
        .sort((a, b) =>
            number(b.convictionScore) - number(a.convictionScore) ||
            number(b.score) - number(a.score)
        );
}

function isStrongOpportunity(card) {
    return number(card.convictionScore) >= 85;
}

function getEmailOpportunities(opportunities) {
    return opportunities
        .filter(isStrongOpportunity)
        .sort((a, b) =>
            number(b.convictionScore) - number(a.convictionScore) ||
            number(b.score) - number(a.score)
        )
        .slice(0, 3);
}

module.exports = {
    buildNmOpportunities,
    computeNmOpportunity,
    isStrongOpportunity,
    getEmailOpportunities
};