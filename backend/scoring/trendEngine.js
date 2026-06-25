const {
    clamp,
    round,
    scoreTriangle
} = require("./utils");

function computeTrendQuality(
    trendVs30,
    historical,
    reasons,
    warnings
) {

    let score = scoreTriangle(
        trendVs30,
        14,
        0,
        55,
        100
    );

    if (historical?.change30d != null) {

        if (
            historical.change30d > 5 &&
            historical.change30d < 35
        ) {

            score += 8;

            reasons.push(
                "Historique 30 jours positif et raisonnable"
            );
        }

        if (
            historical.change30d > 45
        ) {

            score -= 18;

            warnings.push(
                "Hausse historique déjà très avancée"
            );
        }

    }

    score = clamp(score,0,100);

    return round(score,0);

}

module.exports = computeTrendQuality;