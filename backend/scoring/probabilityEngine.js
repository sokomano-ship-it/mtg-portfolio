const { clamp, round } = require("./utils");

function computeBuyProbability(
    trendQuality,
    momentumQuality,
    remainingPotential,
    timingScore,
    riskMultiplier
) {
    const base =
        Number(trendQuality || 0) * 0.22 +
        Number(momentumQuality || 0) * 0.20 +
        Number(remainingPotential || 0) * 0.28 +
        Number(timingScore || 0) * 0.20 +
        8;

    return round(
        clamp(base * Number(riskMultiplier || 1), 0, 95),
        0
    );
}

function getDecision(buyProbability, timingScore) {
    const score = Number(buyProbability || 0);
    const timing = Number(timingScore || 0);

    if (score >= 85 && timing >= 80) {
        return "🟢 Achat fort";
    }

    if (score >= 75 && timing >= 70) {
        return "🟡 Achat intéressant";
    }

    if (score >= 60) {
        return "👀 Surveillance";
    }

    return "Ignorer";
}

module.exports = {
    computeBuyProbability,
    getDecision
};