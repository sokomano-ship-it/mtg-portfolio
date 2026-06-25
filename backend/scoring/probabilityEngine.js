const {
    clamp,
    round
} = require("./utils");

function computeBuyProbability(
    trendQuality,
    momentumQuality,
    remainingPotential,
    riskMultiplier
) {
    const base =
        Number(trendQuality || 0) * 0.30 +
        Number(momentumQuality || 0) * 0.25 +
        Number(remainingPotential || 0) * 0.35 +
        10;

    return round(
        clamp(base * Number(riskMultiplier || 1), 0, 95),
        0
    );
}

function getDecision(buyProbability) {
    const score = Number(buyProbability || 0);

    if (score >= 85) {
        return "🟢 Achat fort";
    }

    if (score >= 75) {
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