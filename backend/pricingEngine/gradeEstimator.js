const fs = require("fs");
const path = require("path");

const CONDITIONS = ["NM", "EX", "GD", "LP", "PL", "PO"];

const marketObservationsPath = path.join(__dirname, "..", "data", "marketObservations.json");

const pricingModelsPath = path.join(
    __dirname,
    "..",
    "data",
    "pricingModels.json"
);

const DEFAULT_GLOBAL_RATIOS = {
    NM: 1.00,
    EX: 0.85,
    GD: 0.72,
    LP: 0.62,
    PL: 0.48,
    PO: 0.35
};

const DEFAULT_BUY_DISCOUNTS = {
    NM: 0.90,
    EX: 0.88
};

function readJson(filePath, fallback) {
    if (!fs.existsSync(filePath)) return fallback;

    try {
        return JSON.parse(fs.readFileSync(filePath, "utf8"));
    } catch {
        return fallback;
    }
}
let pricingModelsCache = null;

function readPricingModels() {
    if (!pricingModelsCache) {
        pricingModelsCache = readJson(pricingModelsPath, {});
    }

    return pricingModelsCache;
}

function normalize(value) {
    return String(value || "")
        .trim()
        .toLowerCase()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/[’']/g, "")
        .replace(/\s+/g, " ");
}

function cardKey(card) {
    return [
        normalize(card.nomCarte || card.nomBase),
        normalize(card.edition),
        normalize(card.langue)
    ].join("|");
}

function sameCard(a, b) {
    return normalize(a.nomCarte) === normalize(b.nomCarte)
        && normalize(a.edition) === normalize(b.edition)
        && normalize(a.langue) === normalize(b.langue);
}

function number(value) {
    const n = Number(value);
    return Number.isFinite(n) ? n : 0;
}

function round(value, decimals = 2) {
    const factor = 10 ** decimals;
    return Math.round(number(value) * factor) / factor;
}

function getObservationDate(row) {
    return String(row.observationDate || row.date || row.createdAt || "").slice(0, 10);
}

function median(values) {
    const clean = values.map(number).filter(v => v > 0).sort((a, b) => a - b);
    if (!clean.length) return 0;

    const middle = Math.floor(clean.length / 2);
    return clean.length % 2
        ? clean[middle]
        : (clean[middle - 1] + clean[middle]) / 2;
}

function percentile(values, pct) {
    const clean = values.map(number).filter(v => v > 0).sort((a, b) => a - b);
    if (!clean.length) return 0;

    const index = Math.min(
        clean.length - 1,
        Math.max(0, Math.floor((pct / 100) * clean.length))
    );

    return clean[index];
}

function getObservationWeight(dayCount) {
    if (dayCount <= 0) {
        return { card: 0.00, edition: 0.40, global: 0.60 };
    }

    if (dayCount <= 2) {
        return { card: 0.30, edition: 0.35, global: 0.35 };
    }

    if (dayCount <= 5) {
        return { card: 0.55, edition: 0.25, global: 0.20 };
    }

    return { card: 0.75, edition: 0.15, global: 0.10 };
}

function conditionMapFromObservations(rows) {
    const byCondition = {};

    CONDITIONS.forEach(condition => {
        byCondition[condition] = rows
            .filter(row => String(row.condition || "").toUpperCase() === condition)
            .map(row => number(row.observedMinPrice))
            .filter(Boolean);
    });

    return byCondition;
}

function latestObservedByCondition(rows) {
    const output = {};

    CONDITIONS.forEach(condition => {
        const sorted = rows
            .filter(row => String(row.condition || "").toUpperCase() === condition)
            .filter(row => number(row.observedMinPrice) > 0)
            .sort((a, b) => getObservationDate(b).localeCompare(getObservationDate(a)));

        output[condition] = sorted[0] ? round(sorted[0].observedMinPrice) : null;
    });

    return output;
}

function observationDaysCount(rows) {
    const dates = new Set();

    rows.forEach(row => {
        const date = getObservationDate(row);
        if (date) dates.add(date);
    });

    return dates.size;
}

function estimateAnchorFromObservations(observedMinByCondition) {
    const candidates = [];

    CONDITIONS.forEach(condition => {
        const observed = number(observedMinByCondition[condition]);
        const ratio = DEFAULT_GLOBAL_RATIOS[condition];

        if (observed > 0 && ratio > 0) {
            candidates.push(observed / ratio);
        }
    });

    return median(candidates);
}

function estimateRatiosFromCardObservations(observedMinByCondition) {
    const nmObserved = number(observedMinByCondition.NM);
    const impliedNm = nmObserved || estimateAnchorFromObservations(observedMinByCondition);

    const ratios = {};

    CONDITIONS.forEach(condition => {
        const observed = number(observedMinByCondition[condition]);

        if (condition === "NM") {
            ratios.NM = 1;
        } else if (observed > 0 && impliedNm > 0) {
            ratios[condition] = Math.min(1, Math.max(0.15, observed / impliedNm));
        } else {
            ratios[condition] = null;
        }
    });

    return ratios;
}

function estimateEditionRatios(card, allObservations) {
    const editionRows = allObservations.filter(row =>
        normalize(row.edition) === normalize(card.edition)
    );

    const grouped = new Map();

    editionRows.forEach(row => {
        const key = [
            normalize(row.nomCarte),
            normalize(row.edition),
            normalize(row.langue),
            getObservationDate(row)
        ].join("|");

        if (!grouped.has(key)) grouped.set(key, []);
        grouped.get(key).push(row);
    });

    const ratiosByCondition = {};
    CONDITIONS.forEach(condition => {
        ratiosByCondition[condition] = [];
    });

    [...grouped.values()].forEach(rows => {
        const map = latestObservedByCondition(rows);
        const ratios = estimateRatiosFromCardObservations(map);

        CONDITIONS.forEach(condition => {
            if (condition === "NM") return;
            if (number(ratios[condition]) > 0) {
                ratiosByCondition[condition].push(ratios[condition]);
            }
        });
    });

    const result = { NM: 1 };

    CONDITIONS.forEach(condition => {
        if (condition === "NM") return;
        result[condition] = median(ratiosByCondition[condition]) || DEFAULT_GLOBAL_RATIOS[condition];
    });

    return result;
}

function blendRatio(condition, cardRatio, editionRatio, weight) {
    const globalRatio = DEFAULT_GLOBAL_RATIOS[condition];

    const safeCardRatio = number(cardRatio) || globalRatio;
    const safeEditionRatio = number(editionRatio) || globalRatio;

    return (
        weight.card * safeCardRatio +
        weight.edition * safeEditionRatio +
        weight.global * globalRatio
    );
}

function estimateMeanPriceFromMin(condition, observedMin) {
    const upliftByCondition = {
        NM: 1.12,
        EX: 1.18,
        GD: 1.22,
        LP: 1.25,
        PL: 1.30,
        PO: 1.35
    };

    return number(observedMin) * (upliftByCondition[condition] || 1.20);
}

function getLearnedConditionRatios(card) {
    const models = readPricingModels();
    const model = models[cardKey(card)];

    if (!model) {
        return null;
    }

    let ratioField = null;

    if (model.modelType === "standard_market_anchor") {
        ratioField = "ratioToMarketAnchor";
    } else if (model.modelType === "edition_ratio") {
        ratioField = "ratioToReferenceMarketAnchor";
    } else {
        return null;
    }

    const nmRatio = number(
        model.byCondition?.NM?.[ratioField]
    );

    if (!nmRatio) {
        return null;
    }

    const learnedRatios = {
        NM: 1
    };

    CONDITIONS.forEach(condition => {
        if (condition === "NM") return;

        const conditionRatio = number(
            model.byCondition?.[condition]?.[ratioField]
        );

        learnedRatios[condition] =
            conditionRatio > 0
                ? Math.min(
                    1,
                    Math.max(0.15, conditionRatio / nmRatio)
                )
                : null;
    });

    return learnedRatios;
}

function enforceMonotonicRatios(ratios) {
    const ordered = {
        NM: 1
    };

    let previousRatio = 1;

    CONDITIONS
        .filter(condition => condition !== "NM")
        .forEach(condition => {
            const currentRatio = number(ratios[condition]);

            const safeRatio = currentRatio > 0
                ? Math.min(previousRatio, currentRatio)
                : previousRatio;

            ordered[condition] = Math.max(0.15, safeRatio);
            previousRatio = ordered[condition];
        });

    return ordered;
}

function estimateCardByGrade(card, options = {}) {
    const allObservations = options.observations || readJson(marketObservationsPath, []);
    const anchorPrice = number(
        options.anchorPrice ||
        card.trendPrice ||
        card.priceEur ||
        card.estimatedPrice ||
        0
    );

    const rows = allObservations.filter(row => sameCard(card, row));
    const dayCount = observationDaysCount(rows);
    const byCondition = conditionMapFromObservations(rows);

    const observedMinByCondition = {};
    CONDITIONS.forEach(condition => {
        observedMinByCondition[condition] = percentile(byCondition[condition], 25) || null;
    });

    const lastObservedMinByCondition = latestObservedByCondition(rows);

    const learnedRatios = getLearnedConditionRatios(card);

const observedCardRatios =
    estimateRatiosFromCardObservations(observedMinByCondition);

const cardRatios = {};

CONDITIONS.forEach(condition => {
    cardRatios[condition] =
        learnedRatios?.[condition] ??
        observedCardRatios?.[condition] ??
        null;
});

const editionRatios = estimateEditionRatios(card, allObservations);
const weight = getObservationWeight(dayCount);

    let inferredAnchor = anchorPrice;

    if (!inferredAnchor) {
        inferredAnchor = estimateAnchorFromObservations(observedMinByCondition);
    }

    const rawRatios = {
    NM: 1
};

CONDITIONS.forEach(condition => {
    if (condition === "NM") return;

    rawRatios[condition] = blendRatio(
        condition,
        cardRatios[condition],
        editionRatios[condition],
        weight
    );
});

const monotonicRatios = enforceMonotonicRatios(rawRatios);

const estimatedByCondition = {};
const ratioByCondition = {};

CONDITIONS.forEach(condition => {
    const ratio = monotonicRatios[condition];

        ratioByCondition[condition] = round(ratio, 4);

        const ratioEstimate = inferredAnchor > 0
            ? inferredAnchor * ratio
            : 0;

        const observedFloorEstimate = observedMinByCondition[condition]
            ? estimateMeanPriceFromMin(condition, observedMinByCondition[condition])
            : 0;

        const blendedEstimate = ratioEstimate && observedFloorEstimate
            ? (ratioEstimate * 0.70 + observedFloorEstimate * 0.30)
            : (ratioEstimate || observedFloorEstimate);

        estimatedByCondition[condition] = blendedEstimate > 0
            ? round(blendedEstimate)
            : null;
    });

    const buyTargetByCondition = {
        NM: estimatedByCondition.NM
            ? round(estimatedByCondition.NM * DEFAULT_BUY_DISCOUNTS.NM)
            : null,
        EX: estimatedByCondition.EX
            ? round(estimatedByCondition.EX * DEFAULT_BUY_DISCOUNTS.EX)
            : null
    };

    const confidence = Math.min(
        95,
        Math.max(
            20,
            (inferredAnchor ? 35 : 0) +
            Math.min(dayCount * 8, 40) +
            (rows.length >= 6 ? 15 : rows.length * 2)
        )
    );

    const sourceParts = [];

    if (anchorPrice > 0) {
    sourceParts.push("anchor");
}

if (dayCount > 0) {
    sourceParts.push(`${dayCount} observation day(s)`);
}

if (learnedRatios) {
    sourceParts.push("trained card ratios");
} else {
    sourceParts.push("global/edition ratios");
}

    return {
        anchorPrice: inferredAnchor ? round(inferredAnchor) : null,
        estimatedByCondition,
        buyTargetByCondition,
        ratioByCondition,
        lastObservedMinByCondition,
        observedMinByCondition,
        observationDaysCount: dayCount,
        observationRowsCount: rows.length,
        confidence: round(confidence, 0),
        source: sourceParts.join(" + ")
    };
}

module.exports = {
    CONDITIONS,
    estimateCardByGrade
};