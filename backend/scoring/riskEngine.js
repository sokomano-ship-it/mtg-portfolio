const {
    clamp,
    round
} = require("./utils");

function computeRiskMultiplier(
    trendPrice,
    trendVs30,
    avg1Vs7,
    historical,
    quantityOwned,
    reasons,
    warnings
) {
    let multiplier = 1;

    if (trendPrice < 5) {
        multiplier *= 0.88;
        warnings.push("Carte peu chère");
    } else {
        reasons.push("Prix NM significatif");
    }

    if (trendVs30 > 50) {
        multiplier *= 0.75;
        warnings.push("Trend très élevé");
    }

    if (avg1Vs7 > 35) {
        multiplier *= 0.72;
        warnings.push("Spike court terme");
    }

    if (quantityOwned >= 4) {
        multiplier *= 0.85;
        warnings.push("Déjà possédé en 4 exemplaires ou plus");
    }

    if (
        historical &&
        historical.volatility !== null &&
        historical.volatility !== undefined
    ) {
        const volatility = Number(historical.volatility || 0);

        if (volatility > 15) {
            multiplier *= 0.78;
            warnings.push("Volatilité historique élevée");
        } else if (volatility <= 6) {
            multiplier *= 1.03;
        }
    }

    return round(
        clamp(multiplier, 0.45, 1.05),
        2
    );
}

module.exports = computeRiskMultiplier;