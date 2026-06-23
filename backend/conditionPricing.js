function normalize(value) {
    return String(value || "").trim().toLowerCase();
}

function getConditionFactor(etat) {
    const value = normalize(etat).toUpperCase();

    const factors = {
        NM: 1.00,
        EX: 0.92,
        GD: 0.82,
        LP: 0.70,
        PL: 0.55,
        PO: 0.35,
        HP: 0.55,
        MP: 0.82
    };

    return factors[value] ?? 1.00;
}

function getEditionLanguageFactor(edition, langue, nmPrice) {
    const ed = normalize(edition);
    const lang = normalize(langue);
    const price = Number(nmPrice || 0);

    if (
        ed.includes("legends") &&
        (lang === "italian" || lang === "italien")
    ) {
        return 0.20;
    }

    if (
        ed === "foreign white bordered" ||
        ed === "foreign white border" ||
        ed === "fwb"
    ) {
        if (lang === "french" || lang === "français" || lang === "francais") {
            if (price < 20) return 1.00;
            if (price < 100) return 1.05;
            return 1.10;
        }

        if (lang === "italian" || lang === "italien") {
            return 0.95;
        }

        if (lang === "german" || lang === "allemand") {
            return 0.95;
        }
    }

    return 1.00;
}

function calculateEtatPrice(nmPrice, etat, edition, langue) {
    const price = Number(nmPrice || 0);

    const conditionFactor = getConditionFactor(etat);
    const editionLanguageFactor = getEditionLanguageFactor(
        edition,
        langue,
        price
    );

    const finalFactor =
        conditionFactor *
        editionLanguageFactor;

    return Number((price * finalFactor).toFixed(2));
}

module.exports = {
    calculateEtatPrice,
    getConditionFactor,
    getEditionLanguageFactor
};