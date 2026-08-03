const fs = require("fs");
const path = require("path");

const {
    buildPrintingConditionSeries
} = require("./analytics/estimatedPriceAnalytics");

const INPUT_PATH = path.join(
    __dirname,
    "..",
    "frontend",
    "data",
    "estimated-price-history.json"
);

const OUTPUT_PATH = path.join(
    __dirname,
    "data",
    "estimatedPriceLaboratory.json"
);

/*
 * On part du 12 juillet, car cette date correspond
 * au début de la version actuelle du modèle.
 */
const MODEL_START_DATE = "2026-07-12";

/*
 * Aucune fenêtre n'est encore considérée comme
 * meilleure qu'une autre.
 *
 * Le laboratoire les calcule toutes afin que nous
 * puissions comparer les résultats réels.
 */
const HORIZONS = [14, 21, 30, 45, 60];

/*
 * États réellement intéressants pour ton objectif
 * d'achat sur Cardmarket.
 */
const CONDITIONS = ["NM", "EX"];

function readJson(filePath, fallback = []) {
    if (!fs.existsSync(filePath)) {
        return fallback;
    }

    try {
        return JSON.parse(
            fs.readFileSync(filePath, "utf8")
        );
    } catch (error) {
        throw new Error(
            `Impossible de lire ${filePath} : ${error.message}`
        );
    }
}

function writeJson(filePath, data) {
    fs.mkdirSync(
        path.dirname(filePath),
        { recursive: true }
    );

    fs.writeFileSync(
        filePath,
        JSON.stringify(data, null, 2),
        "utf8"
    );
}

function round(value, digits = 4) {
    if (
        value === null ||
        value === undefined ||
        !Number.isFinite(Number(value))
    ) {
        return null;
    }

    return Number(
        Number(value).toFixed(digits)
    );
}

function normalizeDate(value) {
    return String(value || "").slice(0, 10);
}

function dateToTimestamp(dateString) {
    return new Date(
        `${normalizeDate(dateString)}T12:00:00Z`
    ).getTime();
}

function daysBetween(dateA, dateB) {
    const milliseconds =
        dateToTimestamp(dateB) -
        dateToTimestamp(dateA);

    return Math.round(
        milliseconds /
        (24 * 60 * 60 * 1000)
    );
}

function parseEstimatedByCondition(row) {
    let values =
        row?.estimatedByCondition || null;

    if (typeof values === "string") {
        try {
            values = JSON.parse(values);
        } catch {
            values = null;
        }
    }

    return (
        values &&
        typeof values === "object"
            ? values
            : null
    );
}

function getConditionPrice(row, condition) {
    const estimatedByCondition =
        parseEstimatedByCondition(row);

    const conditionPrice =
        Number(
            estimatedByCondition?.[condition]
        );

    if (
        Number.isFinite(conditionPrice) &&
        conditionPrice > 0
    ) {
        return conditionPrice;
    }

    /*
     * Les anciennes lignes de l'historique ne
     * possèdent pas toujours estimatedByCondition.
     *
     * On peut utiliser estimatedPrice uniquement
     * lorsque la ligne correspond exactement à
     * l'état demandé.
     */
    if (
        String(row?.etat || "")
            .toUpperCase() === condition
    ) {
        const fallbackPrice =
            Number(row?.estimatedPrice);

        if (
            Number.isFinite(fallbackPrice) &&
            fallbackPrice > 0
        ) {
            return fallbackPrice;
        }
    }

    return null;
}

function getConfidence(row) {
    const confidence =
        Number(
            row?.gradeModelConfidence ??
            row?.confidence
        );

    return Number.isFinite(confidence)
        ? confidence
        : null;
}

function getModelSignature(row) {
    return [
        row?.pricingModel || "",
        row?.gradeModelSource || ""
    ].join("|");
}

function deduplicateDailyRows(rows) {
    /*
     * Si plusieurs lignes existent pour une carte
     * et une date, la dernière ligne gagne.
     */
    const byDate = new Map();

    rows.forEach(row => {
        const date =
            normalizeDate(row?.date);

        if (!date) {
            return;
        }

        byDate.set(date, row);
    });

    return [...byDate.values()].sort(
        (a, b) =>
            normalizeDate(a.date)
                .localeCompare(
                    normalizeDate(b.date)
                )
    );
}

function buildConditionSeries(
    rows,
    condition
) {
    return deduplicateDailyRows(rows)
        .map(row => {
            const price =
                getConditionPrice(
                    row,
                    condition
                );

            if (
                price === null ||
                price <= 0
            ) {
                return null;
            }

            return {
                date: normalizeDate(row.date),
                price,
                confidence:
                    getConfidence(row),

                pricingModel:
                    row.pricingModel || null,

                gradeModelSource:
                    row.gradeModelSource || null,

                modelSignature:
                    getModelSignature(row),

                observationDaysCount:
                    Number(
                        row.observationDaysCount ||
                        0
                    ),

                observationRowsCount:
                    Number(
                        row.observationRowsCount ||
                        0
                    ),

                marketAnchorPrice:
                    Number(
                        row.marketAnchorPrice ||
                        0
                    ) || null,

                pricingRatio:
                    Number.isFinite(
                        Number(row.pricingRatio)
                    )
                        ? Number(
                            row.pricingRatio
                        )
                        : null
            };
        })
        .filter(Boolean);
}

function selectWindowRows(
    series,
    horizonDays
) {
    if (!series.length) {
        return [];
    }

    const latest =
        series[series.length - 1];

    const earliestTimestamp =
        dateToTimestamp(latest.date) -
        (
            (horizonDays - 1) *
            24 *
            60 *
            60 *
            1000
        );

    return series.filter(
        row =>
            dateToTimestamp(row.date) >=
            earliestTimestamp
    );
}

function linearRegression(points) {
    if (points.length < 2) {
        return null;
    }

    const count = points.length;

    const averageX =
        points.reduce(
            (sum, point) =>
                sum + point.x,
            0
        ) / count;

    const averageY =
        points.reduce(
            (sum, point) =>
                sum + point.y,
            0
        ) / count;

    let covariance = 0;
    let varianceX = 0;

    points.forEach(point => {
        const deltaX =
            point.x - averageX;

        const deltaY =
            point.y - averageY;

        covariance +=
            deltaX * deltaY;

        varianceX +=
            deltaX * deltaX;
    });

    if (varianceX === 0) {
        return null;
    }

    const slope =
        covariance / varianceX;

    const intercept =
        averageY -
        slope * averageX;

    const predictedValues =
        points.map(point =>
            intercept +
            slope * point.x
        );

    let totalVariation = 0;
    let residualVariation = 0;

    points.forEach((point, index) => {
        totalVariation += Math.pow(
            point.y - averageY,
            2
        );

        residualVariation += Math.pow(
            point.y -
            predictedValues[index],
            2
        );
    });

    const rSquared =
        totalVariation > 0
            ? 1 -
              (
                  residualVariation /
                  totalVariation
              )
            : 1;

    const residualVariance =
        residualVariation / count;

    return {
        slope,
        intercept,
        rSquared:
            Math.max(
                0,
                Math.min(1, rSquared)
            ),
        residualStandardDeviation:
            Math.sqrt(
                residualVariance
            )
    };
}

function calculateConfidenceStats(rows) {
    const values = rows
        .map(row => row.confidence)
        .filter(value =>
            Number.isFinite(value)
        );

    if (!values.length) {
        return {
            latest: null,
            average: null,
            minimum: null,
            maximum: null,
            change: null
        };
    }

    const latest =
        values[values.length - 1];

    const first =
        values[0];

    return {
        latest:
            round(latest, 1),

        average:
            round(
                values.reduce(
                    (sum, value) =>
                        sum + value,
                    0
                ) / values.length,
                1
            ),

        minimum:
            round(
                Math.min(...values),
                1
            ),

        maximum:
            round(
                Math.max(...values),
                1
            ),

        change:
            round(
                latest - first,
                1
            )
    };
}

function countModelChanges(rows) {
    let changes = 0;

    for (
        let index = 1;
        index < rows.length;
        index += 1
    ) {
        if (
            rows[index].modelSignature !==
            rows[index - 1].modelSignature
        ) {
            changes += 1;
        }
    }

    return changes;
}

function calculatePriceChangeFrequency(rows) {
    if (rows.length < 2) {
        return {
            changedTransitions: 0,
            totalTransitions: 0,
            changedPct: null,
            flatPct: null
        };
    }

    let changedTransitions = 0;

    for (
        let index = 1;
        index < rows.length;
        index += 1
    ) {
        const previous =
            Number(
                rows[index - 1].price
            );

        const current =
            Number(
                rows[index].price
            );

        if (
            previous <= 0 ||
            current <= 0
        ) {
            continue;
        }

        const changePct =
            Math.abs(
                (
                    (current - previous) /
                    previous
                ) * 100
            );

        /*
         * Une variation inférieure à 0,05 %
         * est considérée comme inchangée.
         */
        if (changePct >= 0.05) {
            changedTransitions += 1;
        }
    }

    const totalTransitions =
        rows.length - 1;

    const changedPct =
        totalTransitions > 0
            ? (
                changedTransitions /
                totalTransitions
              ) * 100
            : null;

    return {
        changedTransitions,
        totalTransitions,

        changedPct:
            round(changedPct, 1),

        flatPct:
            changedPct === null
                ? null
                : round(
                    100 - changedPct,
                    1
                )
    };
}

function analyzeWindow(
    series,
    horizonDays
) {
    const rows =
        selectWindowRows(
            series,
            horizonDays
        );

    if (!rows.length) {
        return {
            available: false,
            reason: "Aucun point disponible"
        };
    }

    const first =
        rows[0];

    const latest =
        rows[rows.length - 1];

    const spanDays =
        daysBetween(
            first.date,
            latest.date
        );

    /*
     * Il faut couvrir au moins 80 % de la fenêtre
     * demandée afin d'éviter d'appeler "30 jours"
     * un historique qui n'en couvre que 15.
     */
    const minimumSpanDays =
        Math.floor(
            (horizonDays - 1) * 0.8
        );

    /*
     * On demande aussi au moins 60 % des points
     * quotidiens théoriques.
     */
    const minimumPointCount =
        Math.max(
            5,
            Math.ceil(
                horizonDays * 0.6
            )
        );

    if (
        spanDays < minimumSpanDays ||
        rows.length < minimumPointCount
    ) {
        return {
            available: false,
            reason:
                "Historique insuffisant",

            points:
                rows.length,

            spanDays,

            requiredPoints:
                minimumPointCount,

            requiredSpanDays:
                minimumSpanDays
        };
    }

    const firstTimestamp =
        dateToTimestamp(first.date);

    /*
     * Régression sur log(prix).
     *
     * Ainsi, les pentes sont comparables entre
     * une carte à 2 € et une carte à 500 €.
     */
    const regressionPoints =
        rows.map(row => ({
            x:
                (
                    dateToTimestamp(
                        row.date
                    ) -
                    firstTimestamp
                ) /
                (
                    24 *
                    60 *
                    60 *
                    1000
                ),

            y:
                Math.log(row.price)
        }));

    const regression =
        linearRegression(
            regressionPoints
        );

    if (!regression) {
        return {
            available: false,
            reason:
                "Régression impossible"
        };
    }

    const startPrice =
        Number(first.price);

    const endPrice =
        Number(latest.price);

    const cumulativeChangePct =
        (
            (endPrice - startPrice) /
            startPrice
        ) * 100;

    /*
     * Conversion de la pente logarithmique
     * en variation quotidienne en pourcentage.
     */
    const slopePctPerDay =
        (
            Math.exp(
                regression.slope
            ) -
            1
        ) * 100;

    /*
     * Projection purement descriptive :
     * rythme équivalent sur 30 jours.
     *
     * Ce n'est pas une prévision.
     */
    const equivalent30dPct =
        (
            Math.exp(
                regression.slope * 30
            ) -
            1
        ) * 100;

    /*
     * L'écart-type résiduel est converti en %.
     * Il mesure le bruit autour de la droite
     * de tendance, pas la volatilité du marché.
     */
    const residualNoisePct =
        (
            Math.exp(
                regression
                    .residualStandardDeviation
            ) -
            1
        ) * 100;

    const confidence =
        calculateConfidenceStats(rows);

    const priceFrequency =
        calculatePriceChangeFrequency(
            rows
        );

    return {
        available: true,

        horizonDays,

        startDate:
            first.date,

        endDate:
            latest.date,

        points:
            rows.length,

        spanDays,

        startPrice:
            round(startPrice, 2),

        endPrice:
            round(endPrice, 2),

        cumulativeChangePct:
            round(
                cumulativeChangePct,
                2
            ),

        logSlopePerDay:
            round(
                regression.slope,
                8
            ),

        slopePctPerDay:
            round(
                slopePctPerDay,
                4
            ),

        equivalent30dPct:
            round(
                equivalent30dPct,
                2
            ),

        rSquared:
            round(
                regression.rSquared,
                4
            ),

        residualNoisePct:
            round(
                residualNoisePct,
                3
            ),

        confidence,

        modelChangeCount:
            countModelChanges(rows),

        priceFrequency
    };
}

function buildCardGroups(history) {
    const groups = new Map();

    history.forEach(row => {
        const date =
            normalizeDate(row?.date);

        const cardId =
            Number(row?.cardId);

        if (
            !date ||
            date < MODEL_START_DATE ||
            !Number.isFinite(cardId)
        ) {
            return;
        }

        if (!groups.has(cardId)) {
            groups.set(cardId, {
                cardId,
                nomCarte:
                    row.nomCarte || "",
                edition:
                    row.edition || "",
                langue:
                    row.langue || "",
                version:
                    row.version || "",
                rows: []
            });
        }

        const group =
            groups.get(cardId);

        /*
         * Les métadonnées les plus récentes gagnent.
         */
        group.nomCarte =
            row.nomCarte ||
            group.nomCarte;

        group.edition =
            row.edition ||
            group.edition;

        group.langue =
            row.langue ||
            group.langue;

        group.version =
            row.version ||
            group.version;

        group.rows.push(row);
    });

    return [...groups.values()];
}

function analyzePreparedSeries(
    preparedSeries
) {
    const fullSeries =
        preparedSeries.rows || [];

    const stableSeries =
        preparedSeries.stableRows || [];

    if (
        !fullSeries.length ||
        !stableSeries.length
    ) {
        return null;
    }

    const first =
        fullSeries[0];

    const stableFirst =
        stableSeries[0];

    const latest =
        fullSeries[
            fullSeries.length - 1
        ];

    /*
     * Point essentiel :
     * toutes les statistiques de tendance sont
     * calculées uniquement après la dernière
     * rupture structurelle du modèle.
     */
    const horizons =
        Object.fromEntries(
            HORIZONS.map(days => [
                `${days}d`,
                analyzeWindow(
                    stableSeries,
                    days
                )
            ])
        );

    const availableHorizons =
        HORIZONS.filter(
            days =>
                horizons[
                    `${days}d`
                ]?.available
        );

    return {
        printingKey:
            preparedSeries.printingKey,

        cardIds:
            preparedSeries.cardIds,

        quantity:
            preparedSeries.quantity,

        nomCarte:
            preparedSeries.nomCarte,

        edition:
            preparedSeries.edition,

        langue:
            preparedSeries.langue,

        version:
            preparedSeries.version || null,

        condition:
            preparedSeries.condition,

        /*
         * Historique brut disponible.
         */
        firstDate:
            first.date,

        latestDate:
            latest.date,

        historyPoints:
            fullSeries.length,

        historyAgeDays:
            daysBetween(
                first.date,
                latest.date
            ),

        /*
         * Historique réellement utilisé pour
         * les calculs de tendance.
         */
        stableSince:
            preparedSeries.stableSince,

        stableHistoryPoints:
            stableSeries.length,

        stableHistoryAgeDays:
            daysBetween(
                stableFirst.date,
                latest.date
            ),

        structuralBreakCount:
            preparedSeries
                .structuralBreakCount,

        lastStructuralBreak:
            preparedSeries
                .lastStructuralBreak,

        structuralBreaks:
            preparedSeries
                .structuralBreaks,

        latestPrice:
            round(
                latest.price,
                2
            ),

        latestConfidence:
            round(
                latest.confidence,
                1
            ),

        pricingModel:
            latest.pricingModel,

        modelFamily:
            latest.modelFamily,

        gradeModelSource:
            latest.gradeModelSource,

        observationDaysCount:
            latest.observationDaysCount,

        observationRowsCount:
            latest.observationRowsCount,

        marketAnchorPrice:
            round(
                latest.marketAnchorPrice,
                2
            ),

        referenceMarketAnchorPrice:
            round(
                latest
                    .referenceMarketAnchorPrice,
                2
            ),

        pricingRatio:
            round(
                latest.pricingRatio,
                6
            ),

        availableHorizons,

        horizons
    };
}

function buildSummary(rows) {
    const summary = {
        totalSeries: rows.length,
        totalPrintings:
    new Set(
        rows.map(
            row => row.printingKey
        )
    ).size,

totalPhysicalCards:
    new Set(
        rows.flatMap(
            row => row.cardIds || []
        )
    ).size,

seriesWithStructuralBreak:
    rows.filter(
        row =>
            row.structuralBreakCount > 0
    ).length,

        nmSeries:
            rows.filter(
                row =>
                    row.condition === "NM"
            ).length,

        exSeries:
            rows.filter(
                row =>
                    row.condition === "EX"
            ).length,

        byAvailableHorizon: {}
    };

    HORIZONS.forEach(days => {
        summary.byAvailableHorizon[
            `${days}d`
        ] = rows.filter(
            row =>
                row.horizons[
                    `${days}d`
                ]?.available
        ).length;
    });

    return summary;
}

function main() {
    const history =
        readJson(
            INPUT_PATH,
            []
        );

    if (!Array.isArray(history)) {
        throw new Error(
            "L'historique estimé n'est pas un tableau JSON."
        );
    }

    const preparedSeries =
    buildPrintingConditionSeries(
        history,
        {
            startDate:
                MODEL_START_DATE,

            conditions:
                CONDITIONS
        }
    );

const rows =
    preparedSeries
        .map(analyzePreparedSeries)
        .filter(Boolean);

    rows.sort((a, b) => {
        const nameComparison =
            String(a.nomCarte)
                .localeCompare(
                    String(b.nomCarte),
                    "fr",
                    {
                        sensitivity: "base"
                    }
                );

        if (nameComparison !== 0) {
            return nameComparison;
        }

        const editionComparison =
            String(a.edition)
                .localeCompare(
                    String(b.edition),
                    "fr",
                    {
                        sensitivity: "base"
                    }
                );

        if (editionComparison !== 0) {
            return editionComparison;
        }

        const languageComparison =
    String(a.langue)
        .localeCompare(
            String(b.langue),
            "fr",
            {
                sensitivity: "base"
            }
        );

if (languageComparison !== 0) {
    return languageComparison;
}

const versionComparison =
    String(a.version || "")
        .localeCompare(
            String(b.version || ""),
            "fr",
            {
                sensitivity: "base"
            }
        );

if (versionComparison !== 0) {
    return versionComparison;
}

return String(a.condition)
    .localeCompare(
        String(b.condition)
    );
    });

    const output = {
        generatedAt:
            new Date().toISOString(),

        sourceFile:
            "frontend/data/estimated-price-history.json",

        modelStartDate:
            MODEL_START_DATE,

        conditions:
            CONDITIONS,

        horizons:
            HORIZONS,

        methodology: {
            regression:
                "linear regression on log(price)",

            slopeUnit:
                "percentage per calendar day",

            qualityMetric:
                "R-squared",

            noiseMetric:
                "standard deviation of log-regression residuals",

            minimumWindowCoveragePct:
                80,

            minimumDailyPointCoveragePct:
                60,

            decisionRule:
                "none - laboratory output only"
        },

        summary:
            buildSummary(rows),

        rows
    };

    writeJson(
        OUTPUT_PATH,
        output
    );

    console.log(
        `Laboratoire généré : ${OUTPUT_PATH}`
    );

    console.log(
    `${output.summary.totalPrintings} impression(s) distincte(s) analysée(s)`
);

console.log(
    `${output.summary.totalPhysicalCards} carte(s) physique(s) regroupée(s)`
);

console.log(
    `${rows.length} série(s) NM/EX générée(s)`
);

console.log(
    `${output.summary.seriesWithStructuralBreak} série(s) avec rupture structurelle`
);

    

    HORIZONS.forEach(days => {
        console.log(
            `${days} jours disponibles : ` +
            output.summary
                .byAvailableHorizon[
                    `${days}d`
                ]
        );
    });
}

try {
    main();
} catch (error) {
    console.error(error);
    process.exit(1);
}