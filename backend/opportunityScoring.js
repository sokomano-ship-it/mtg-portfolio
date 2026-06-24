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

    let score =
        trendVs30 * 0.35 +
        avg7Vs30 * 0.30 +
        avg1Vs7 * 0.25 +
        lowDiscount * 0.10;

    let signal = "Neutre";
    let alert = "";

    if (trendVs30 >= 25 && avg7Vs30 >= 10 && avg1Vs7 >= 5) {
        signal = "🔥 Breakout NM";
        alert = "Forte accélération court terme";
        score += 10;
    } else if (avg1 > avg7 && avg7 > avg30 && trendVs30 >= 10) {
        signal = "📈 Momentum positif NM";
        alert = "Tendance haussière régulière";
        score += 5;
    } else if (trendVs30 >= 35) {
        signal = "⚠️ Sur-extension NM";
        alert = "Hausse forte, risque de correction";
        score -= 5;
    } else if (trendVs30 <= -15) {
        signal = "📉 Correction NM";
        alert = "Prix sous la moyenne 30 jours";
    } else if (lowDiscount >= 20 && trendVs30 >= 5) {
        signal = "💎 Opportunité achat NM";
        alert = "Low price inférieur au trend";
        score += 5;
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

        score: round(score),
        signal,
        alert
    };
}

function buildNmOpportunities(cards) {
    return deduplicateNmOpportunities(cards)
        .filter(card =>
            number(card.trendPrice) > 0 &&
            number(card.avg30) > 0
        )
        .map(computeNmOpportunity)
        .sort((a, b) => number(b.score) - number(a.score));
}

function isStrongOpportunity(card) {
    return (
        number(card.score) >= 15 ||
        card.signal === "🔥 Breakout NM" ||
        card.signal === "💎 Opportunité achat NM"
    );
}

module.exports = {
    buildNmOpportunities,
    computeNmOpportunity,
    isStrongOpportunity
};