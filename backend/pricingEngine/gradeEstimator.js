const fs = require("fs");
const path = require("path");
const {
    DEFAULT_GLOBAL_RATIOS,
    buildHierarchicalRatios,
    calculateBayesianConfidence,
    calculateObservationReliability,
    weightedMedian
} = require("./bayesianEngine");
const CONDITIONS = ["NM", "EX", "GD", "LP", "PL", "PO"];

const marketObservationsPath = path.join(__dirname, "..", "data", "marketObservations.json");

const pricingModelsPath = path.join(
    __dirname,
    "..",
    "data",
    "pricingModels.json"
);



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

function buildReliableObservedPrices(rows, anchorPrice) {
    const reliableByCondition = {};
    const reliabilityByCondition = {};

    const rawObservedByCondition = {};

    CONDITIONS.forEach(condition => {
        const values = rows
            .filter(row =>
                String(row.condition || "").toUpperCase() === condition
            )
            .map(row => number(row.observedMinPrice))
            .filter(value => value > 0);

        rawObservedByCondition[condition] =
            percentile(values, 25) || null;
    });

    /*
     * Le NM observé définit prioritairement le niveau de la carte.
     * L'ancre marché n'est utilisée que lorsqu'aucun NM n'est disponible.
     */
    const observedNm = number(rawObservedByCondition.NM);

    const referenceNm =
        observedNm ||
        number(anchorPrice) ||
        estimateAnchorFromObservations(rawObservedByCondition);

    CONDITIONS.forEach(condition => {
        const conditionRows = rows
            .filter(row =>
                String(row.condition || "").toUpperCase() === condition
            )
            .map(row => number(row.observedMinPrice))
            .filter(value => value > 0);

        if (!conditionRows.length) {
            reliableByCondition[condition] = null;
            reliabilityByCondition[condition] = null;
            return;
        }

        const expectedPrice =
            condition === "NM"
                ? referenceNm
                : referenceNm *
                  number(DEFAULT_GLOBAL_RATIOS[condition]);

        const entries = conditionRows.map(observedPrice => {
            const reliability =
                calculateObservationReliability({
                    observedPrice,
                    expectedPrice,
                    sampleSize: conditionRows.length
                });

            return {
                value: observedPrice,
                weight: reliability
            };
        });

        /*
         * Le modèle attendu sert d'a priori.
         * Une observation atypique reste enregistrée mais ne domine pas.
         */
        entries.push({
            value: expectedPrice,
            weight: 1
        });

        reliableByCondition[condition] =
            round(weightedMedian(entries));

        reliabilityByCondition[condition] =
            round(
                entries
                    .slice(0, -1)
                    .reduce(
                        (sum, entry) => sum + entry.weight,
                        0
                    ) / conditionRows.length,
                2
            );
    });

    return {
        reliableByCondition,
        reliabilityByCondition
    };
}

function averageReliability(reliabilityByCondition) {
    const values = Object.values(reliabilityByCondition || {})
        .map(number)
        .filter(value => value > 0);

    if (!values.length) {
        return 0;
    }

    return round(
        values.reduce((sum, value) => sum + value, 0) /
        values.length,
        2
    );
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

    return estimateGroupRatios(editionRows);
}
function estimateLanguageRatios(card, allObservations) {
    const editionLanguageRows = allObservations.filter(row =>
        normalize(row.edition) === normalize(card.edition) &&
        normalize(row.langue) === normalize(card.langue)
    );

    return estimateGroupRatios(editionLanguageRows);
}

function countGroupObservationRows(
    card,
    allObservations
) {

    function countDistinctCardDays(rows) {

        const keys = new Set();

        rows.forEach(row => {

            const date =
                getObservationDate(row);

            if (!date) {
                return;
            }

            const key = [
                normalize(row.nomCarte),
                normalize(row.edition),
                normalize(row.langue),
                date
            ].join("|");

            keys.add(key);

        });

        return keys.size;

    }


    const editionRows =
        allObservations.filter(row =>
            normalize(row.edition) ===
            normalize(card.edition)
        );


    const languageRows =
        editionRows.filter(row =>
            normalize(row.langue) ===
            normalize(card.langue)
        );


    return {

        edition:
            countDistinctCardDays(
                editionRows
            ),

        language:
            countDistinctCardDays(
                languageRows
            ),

        global:
            countDistinctCardDays(
                allObservations
            )

    };

}

function estimateGroupRatios(rows) {

    /*
     * 1. Groupement par carte puis date.
     */
    const cardGroups =
        new Map();


    rows.forEach(row => {

        const cardKey = [
            normalize(row.nomCarte),
            normalize(row.edition),
            normalize(row.langue)
        ].join("|");


        if (!cardGroups.has(cardKey)) {

            cardGroups.set(
                cardKey,
                new Map()
            );

        }


        const date =
            getObservationDate(row);


        if (!date) {
            return;
        }


        const dateGroups =
            cardGroups.get(cardKey);


        if (!dateGroups.has(date)) {

            dateGroups.set(
                date,
                []
            );

        }


        dateGroups
            .get(date)
            .push(row);

    });


    /*
     * Chaque carte produira au maximum
     * UN ratio final par état.
     */
    const cardRatiosByCondition = {};

    CONDITIONS.forEach(condition => {

        cardRatiosByCondition[
            condition
        ] = [];

    });


    cardGroups.forEach(
        dateGroups => {

            const ratiosByDate = {};

            CONDITIONS.forEach(condition => {

                ratiosByDate[
                    condition
                ] = [];

            });


            dateGroups.forEach(
                groupRows => {

                    const observedMap =
                        latestObservedByCondition(
                            groupRows
                        );


                    const ratios =
                        estimateRatiosFromCardObservations(
                            observedMap
                        );


                    CONDITIONS.forEach(
                        condition => {

                            if (
                                condition ===
                                "NM"
                            ) {
                                return;
                            }


                            const ratio =
                                number(
                                    ratios[
                                        condition
                                    ]
                                );


                            if (ratio > 0) {

                                ratiosByDate[
                                    condition
                                ].push(
                                    ratio
                                );

                            }

                        }
                    );

                }
            );


            /*
             * Une carte = une contribution,
             * quelle que soit la quantité
             * de jours observés.
             */
            CONDITIONS.forEach(
                condition => {

                    if (
                        condition === "NM"
                    ) {
                        return;
                    }


                    const cardRatio =
                        median(
                            ratiosByDate[
                                condition
                            ]
                        );


                    if (cardRatio > 0) {

                        cardRatiosByCondition[
                            condition
                        ].push(
                            cardRatio
                        );

                    }

                }
            );

        }
    );


    const result = {
        NM: 1
    };


    CONDITIONS.forEach(
        condition => {

            if (
                condition === "NM"
            ) {
                return;
            }


            result[condition] =
                median(
                    cardRatiosByCondition[
                        condition
                    ]
                ) ||
                DEFAULT_GLOBAL_RATIOS[
                    condition
                ];

        }
    );


    return result;

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

    /*
 * Minima réels conservés pour l'historique et l'affichage.
 */
const observedMinByCondition = {};

CONDITIONS.forEach(condition => {
    observedMinByCondition[condition] =
        percentile(byCondition[condition], 25) ||
        null;
});

const lastObservedMinByCondition =
    latestObservedByCondition(rows);

/*
 * Version fiabilisée utilisée uniquement par le modèle.
 */
const {
    reliableByCondition,
    reliabilityByCondition
} = buildReliableObservedPrices(
    rows,
    anchorPrice
);

const learnedRatios =
    getLearnedConditionRatios(card);

const reliableCardRatios =
    estimateRatiosFromCardObservations(
        reliableByCondition
    );

const cardRatios = {};

CONDITIONS.forEach(condition => {

    const reliability =
        number(
            reliabilityByCondition
                ?.[condition]
        );


    const hasMatureCardHistory =
        dayCount >= 5 &&
        reliability >= 0.65;


    /*
     * Un ratio propre à la carte ne devient
     * prioritaire que lorsque nous avons
     * suffisamment de recul temporel.
     *
     * Avant cela, on utilise la version
     * fiabilisée, qui reste sous contrôle
     * du prior global / édition / langue.
     */
    if (
        hasMatureCardHistory &&
        learnedRatios?.[condition]
    ) {

        cardRatios[condition] =
            learnedRatios[condition];

    } else {

        cardRatios[condition] =
            reliableCardRatios
                ?.[condition] ??
            null;

    }

});

const editionRatios =
    estimateEditionRatios(card, allObservations);

const languageRatios =
    estimateLanguageRatios(card, allObservations);

const groupObservationCounts =
    countGroupObservationRows(card, allObservations);

const reliableNmFloor =
    number(
        reliableByCondition?.NM
    );


let observedNmAnchor = 0;


if (reliableNmFloor > 0) {

    /*
     * Le minimum NM est un plancher,
     * pas le prix moyen.
     */
    const estimatedNmMarketLevel =
        estimateMeanPriceFromMin(
            "NM",
            reliableNmFloor
        );


    /*
     * Plus on possède de jours,
     * plus on autorise le minimum NM
     * transformé à relever l'ancre.
     *
     * 2 jours -> 33 %
     * 5 jours -> 56 %
     * 10 jours -> 71 %
     */
    const nmObservationStrength =
        dayCount /
        (
            dayCount + 4
        );


    observedNmAnchor =
        reliableNmFloor *
            (
                1 -
                nmObservationStrength
            ) +
        estimatedNmMarketLevel *
            nmObservationStrength;

}


let inferredAnchor = 0;


if (
    anchorPrice > 0 &&
    observedNmAnchor > 0
) {

    /*
     * Le Trend reste une information essentielle,
     * mais il ne peut pas forcer le niveau NM
     * sous un plancher NM crédible.
     */
    inferredAnchor =
        Math.max(
            anchorPrice,
            observedNmAnchor
        );

} else {

    inferredAnchor =
        anchorPrice ||
        observedNmAnchor ||
        estimateAnchorFromObservations(
            observedMinByCondition
        );

}

    const {
    ratios: monotonicRatios,
    weights
} = buildHierarchicalRatios({
    cardRatios,
    editionRatios,
    languageRatios,
    evidence: {
        cardObservationDays: dayCount,
        cardObservationRows: rows.length,
        editionObservationRows:
    groupObservationCounts.edition,

languageObservationRows:
    groupObservationCounts.language,

globalObservationRows:
    groupObservationCounts.global
    }
});

const estimatedByCondition = {};
const ratioByCondition = {};

CONDITIONS.forEach(condition => {
    const ratio = monotonicRatios[condition];

        ratioByCondition[condition] = round(ratio, 4);

        const ratioEstimate = inferredAnchor > 0
            ? inferredAnchor * ratio
            : 0;

        const reliableObservedPrice =
    reliableByCondition[condition];

const observedFloorEstimate =
    reliableObservedPrice
        ? estimateMeanPriceFromMin(
            condition,
            reliableObservedPrice
        )
        : 0;

        const observationReliability =
    number(
        reliabilityByCondition
            ?.[condition]
    );


/*
 * Le minimum observé transformé en
 * niveau moyen reçoit :
 *
 * fiabilité 0 %   -> 10 %
 * fiabilité 40 %  -> 18 %
 * fiabilité 70 %  -> 24 %
 * fiabilité 100 % -> 30 %
 */
const observedWeight =
    observedFloorEstimate
        ? Math.min(
            0.30,
            0.10 +
            observationReliability *
                0.20
        )
        : 0;


const ratioWeight =
    1 -
    observedWeight;


const blendedEstimate =
    ratioEstimate &&
    observedFloorEstimate

        ? (
            ratioEstimate *
                ratioWeight +

            observedFloorEstimate *
                observedWeight
        )

        : (
            ratioEstimate ||
            observedFloorEstimate
        );

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

    const confidence = calculateBayesianConfidence({
    hasAnchor: inferredAnchor > 0,
    cardObservationDays: dayCount,
    cardObservationRows: rows.length,
    editionObservationRows:
    groupObservationCounts.edition,

languageObservationRows:
    groupObservationCounts.language,

globalObservationRows:
    groupObservationCounts.global,
    usesExternalReference: Boolean(card.usesExternalReference),
    referenceFound: card.referenceFound !== false
});

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
        bayesianWeights: {
    card: round(weights.card, 4),
    edition: round(weights.edition, 4),
    language: round(weights.language, 4),
    global: round(weights.global, 4)
},
        lastObservedMinByCondition,
        observedMinByCondition,
        reliableObservedByCondition:
    reliableByCondition,

observationReliabilityByCondition:
    reliabilityByCondition,

averageObservationReliability:
    averageReliability(
        reliabilityByCondition
    ),
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