const {
    clamp,
    round,
    scoreRange
} = require("./utils");

function computeMomentumQuality(
    avg1,
    avg7,
    avg30,
    avg1Vs7,
    reasons,
    warnings
) {

    let score = 0;

    if (
        avg1 > avg7 &&
        avg7 > avg30
    ) {

        score += 45;

        reasons.push(
            "Momentum propre"
        );

    }

    else if (
        avg7 > avg30
    ) {

        score += 25;

        reasons.push(
            "Momentum positif"
        );

    }

    score += scoreRange(
        avg1Vs7,
        2,
        15,
        -10,
        35,
        35
    );

    if (
        avg1Vs7 > 35
    ) {

        score -= 30;

        warnings.push(
            "Spike détecté"
        );

    }

    if (
        avg1Vs7 < 0
    ) {

        score -= 15;

        warnings.push(
            "Momentum négatif"
        );

    }

    return round(
        clamp(score,0,100),
        0
    );

}

module.exports = computeMomentumQuality;