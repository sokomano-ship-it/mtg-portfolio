const {
    clamp,
    round,
    scoreTriangle,
    scoreRange
} = require("./utils");

function computeRemainingPotential(
    trendVs30,
    avg1Vs7,
    historical,
    reasons,
    warnings
) {
    let score = 50;

    score += scoreTriangle(
        trendVs30,
        12,
        0,
        45,
        30
    );

    score += scoreRange(
        avg1Vs7,
        1,
        15,
        -8,
        35,
        20
    );

    if (historical) {
        const historyPoints = Number(historical.historyPoints || 0);
        const position90d = historical.position90dPct;
        const uptrendDays = Number(historical.uptrendDays || 0);
        const volatility = historical.volatility;

        if (historyPoints >= 10) {
            if (position90d !== null && position90d !== undefined) {
                const position = Number(position90d || 0);

                if (position >= 35 && position <= 75) {
                    score += 15;
                    reasons.push("Position 90 jours équilibrée");
                } else if (position > 90) {
                    score -= 25;
                    warnings.push("Très proche du plus haut 90 jours");
                } else if (position < 25) {
                    score -= 5;
                    warnings.push("Encore proche du bas 90 jours");
                }
            }

            if (uptrendDays >= 3 && uptrendDays <= 18) {
                score += 10;
                reasons.push("Hausse récente mais pas trop mature");
            } else if (uptrendDays > 30) {
                score -= 15;
                warnings.push("Hausse déjà longue");
            }

            if (volatility !== null && volatility !== undefined) {
                const vol = Number(volatility || 0);

                if (vol <= 6) {
                    score += 8;
                    reasons.push("Volatilité historique faible");
                } else if (vol > 15) {
                    score -= 18;
                    warnings.push("Volatilité élevée");
                }
            }
        } else {
            score -= 8;
            warnings.push("Historique encore court");
        }
    } else {
        score -= 10;
        warnings.push("Pas encore assez d'historique interne");
    }

    return round(
        clamp(score, 0, 100),
        0
    );
}

module.exports = computeRemainingPotential;