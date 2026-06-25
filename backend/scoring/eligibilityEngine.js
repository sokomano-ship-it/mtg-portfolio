function isEligible(card) {
    const trendPrice = Number(card.trendPrice || 0);
    const avg30 = Number(card.avg30 || 0);

    if (trendPrice <= 0) return false;
    if (avg30 <= 0) return false;

    return true;
}

module.exports = isEligible;