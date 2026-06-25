function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
}

function round(value, digits = 1) {
    return Number((Number(value) || 0).toFixed(digits));
}

function pct(current, previous) {
    if (!current || !previous || previous <= 0) return 0;
    return ((current - previous) / previous) * 100;
}

function scoreTriangle(value, ideal, min, max, maxScore) {

    if (value <= min || value >= max)
        return 0;

    if (value === ideal)
        return maxScore;

    if (value < ideal)
        return ((value - min) / (ideal - min)) * maxScore;

    return ((max - value) / (max - ideal)) * maxScore;
}

function scoreRange(value, minGood, maxGood, minAcceptable, maxAcceptable, maxScore) {

    if (value >= minGood && value <= maxGood)
        return maxScore;

    if (value < minGood && value > minAcceptable)
        return ((value - minAcceptable) / (minGood - minAcceptable)) * maxScore;

    if (value > maxGood && value < maxAcceptable)
        return ((maxAcceptable - value) / (maxAcceptable - maxGood)) * maxScore;

    return 0;
}

module.exports = {
    clamp,
    round,
    pct,
    scoreTriangle,
    scoreRange
};