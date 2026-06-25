const { clamp, round, scoreTriangle, scoreRange } = require("./utils");

function computeTimingScore(
    trendVs30,
    avg1Vs7,
    historical,
    reasons,
    warnings
) {
    let score = 50;

    score += scoreTriangle(trendVs30, 12, 0, 45, 25);
    score += scoreRange(avg1Vs7, 1, 14, -8, 35, 20);

    if (historical) {
        const position90d = historical.position90dPct;
        const uptrendDays = Number(historical.uptrendDays || 0);
        const volatility30 = historical.volatility30;
        const acceleration = historical.acceleration;

        if (position90d !== null && position90d !== undefined) {
            const positionScore = scoreTriangle(Number(position90d), 55, 10, 100, 25);
            score += positionScore;

            if (position90d > 90) {
                warnings.push("Timing moins bon : proche du plus haut 90 jours");
            } else if (position90d >= 35 && position90d <= 75) {
                reasons.push("Timing favorable : position 90 jours équilibrée");
            }
        }

        if (uptrendDays > 0) {
            const durationScore = scoreTriangle(uptrendDays, 10, 0, 45, 15);
            score += durationScore;

            if (uptrendDays >= 5 && uptrendDays <= 18) {
                reasons.push("Timing favorable : hausse récente mais pas trop mature");
            } else if (uptrendDays > 30) {
                warnings.push("Timing moins bon : hausse déjà longue");
            }
        }

        if (volatility30 !== null && volatility30 !== undefined) {
            const vol = Number(volatility30 || 0);

            if (vol <= 6) {
                score += 8;
                reasons.push("Timing renforcé par une volatilité faible");
            } else if (vol > 15) {
                score -= 15;
                warnings.push("Timing dégradé par une volatilité élevée");
            }
        }

        if (acceleration !== null && acceleration !== undefined) {
            const acc = Number(acceleration || 0);

            if (acc > 0 && acc <= 8) {
                score += 8;
                reasons.push("Accélération historique favorable");
            } else if (acc > 18) {
                score -= 12;
                warnings.push("Accélération historique trop forte");
            } else if (acc < -8) {
                score -= 8;
                warnings.push("Accélération historique négative");
            }
        }
    } else {
        score -= 10;
        warnings.push("Timing estimé avec peu d'historique");
    }

    return round(clamp(score, 0, 100), 0);
}

module.exports = computeTimingScore;