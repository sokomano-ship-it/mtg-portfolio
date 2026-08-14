const CONDITIONS = ["NM", "EX"];

function normalizeText(value) {
    return String(value || "")
        .trim()
        .toLowerCase()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "");
}

function normalizeDate(value) {
    return String(value || "").slice(0, 10);
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
        typeof values === "object" &&
        !Array.isArray(values)
            ? values
            : null
    );
}

function getConditionPrice(
    row,
    condition
) {
    const normalizedCondition =
        String(condition || "")
            .toUpperCase();

    const estimatedByCondition =
        parseEstimatedByCondition(row);

    const conditionPrice =
        Number(
            estimatedByCondition?.[
                normalizedCondition
            ]
        );

    if (
        Number.isFinite(conditionPrice) &&
        conditionPrice > 0
    ) {
        return conditionPrice;
    }

    /*
     * Les anciennes lignes ne possèdent pas
     * toujours estimatedByCondition.
     *
     * estimatedPrice n'est utilisable que si
     * l'état de la ligne correspond exactement
     * à l'état demandé.
     */
    const rowCondition =
        String(row?.etat || "")
            .toUpperCase();

    if (
        rowCondition ===
        normalizedCondition
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

function getModelFamily(row) {
    const pricingModel =
        normalizeText(row?.pricingModel);

    const source =
        normalizeText(row?.gradeModelSource);

    if (
        pricingModel.includes("manual") ||
        source.includes("manual")
    ) {
        return "manual";
    }

    if (
        pricingModel.includes("edition") ||
        source.includes("edition")
    ) {
        return "edition_reference";
    }

    if (
        pricingModel.includes("observed") &&
        (
            source.includes("trained") ||
            source.includes("observation")
        )
    ) {
        return "observed_trained";
    }

    if (
        pricingModel.includes("fallback") ||
        source.includes("fallback") ||
        source.includes("global/edition")
    ) {
        return "fallback";
    }

    if (
        pricingModel.includes("standard")
    ) {
        return "standard";
    }

    return pricingModel || source || "unknown";
}

function relativeRatioChange(
    previousValue,
    currentValue
) {
    const previous =
        Number(previousValue);

    const current =
        Number(currentValue);

    if (
        !Number.isFinite(previous) ||
        !Number.isFinite(current) ||
        previous <= 0 ||
        current <= 0
    ) {
        return null;
    }

    return Math.max(
        current / previous,
        previous / current
    );
}

function getConfidence(row) {
    const value =
        Number(
            row?.gradeModelConfidence ??
            row?.confidence
        );

    return Number.isFinite(value)
        ? value
        : null;
}

function buildPrintingKey(row) {
    return [
        normalizeText(row?.nomCarte),
        normalizeText(row?.edition),
        normalizeText(row?.version),
        normalizeText(row?.langue)
    ].join("|");
}

function getHistoryEntityId(row) {
    const numericCardId = Number(row?.cardId);

    if (Number.isFinite(numericCardId)) {
        return numericCardId;
    }

    const trackedId =
        String(row?.trackedId || "").trim();

    if (trackedId) {
        return `tracked:${trackedId}`;
    }

    return null;
}

function chooseMostRecentValue(
    currentValue,
    candidateValue
) {
    if (
        candidateValue !== null &&
        candidateValue !== undefined &&
        candidateValue !== ""
    ) {
        return candidateValue;
    }

    return currentValue;
}

function groupHistoryByPrinting(
    history,
    options = {}
) {
    const {
        startDate = null
    } = options;

    const groups = new Map();

    (history || []).forEach(
        (row, sourceIndex) => {
            const date =
                normalizeDate(row?.date);

            const cardId =
    getHistoryEntityId(row);

if (
    !date ||
    cardId === null
) {
    return;
}

            if (
                startDate &&
                date < startDate
            ) {
                return;
            }

            const key =
                buildPrintingKey(row);

            if (
                !key ||
                key === "|||"
            ) {
                return;
            }

            if (!groups.has(key)) {
                groups.set(key, {
    printingKey: key,

    nomCarte:
        row.nomCarte || "",

    edition:
        row.edition || "",

    version:
        row.version || "",

    langue:
        row.langue || "",

    historySource:
        row.historySource ||
        (
            String(cardId).startsWith("tracked:")
                ? "tracked"
                : "collection"
        ),

    owned:
        row.owned !== undefined
            ? Boolean(row.owned)
            : !String(cardId).startsWith("tracked:"),

    cardIds:
        new Set(),

    rowsByDate:
        new Map()
});
            }

            const group =
                groups.get(key);

            group.cardIds.add(cardId);

            /*
             * Les métadonnées les plus récentes
             * et non vides gagnent.
             */
            group.nomCarte =
                chooseMostRecentValue(
                    group.nomCarte,
                    row.nomCarte
                );

            group.edition =
                chooseMostRecentValue(
                    group.edition,
                    row.edition
                );

            group.version =
                chooseMostRecentValue(
                    group.version,
                    row.version
                );

            group.langue =
                chooseMostRecentValue(
                    group.langue,
                    row.langue
                );

            const currentDailyRow =
                group.rowsByDate.get(date);

            /*
             * Si plusieurs exemplaires identiques
             * ont une ligne le même jour, on garde
             * la dernière ligne du fichier.
             *
             * Les exemplaires d'une même impression
             * doivent normalement produire les mêmes
             * estimations.
             */
            if (
                !currentDailyRow ||
                sourceIndex >
                    currentDailyRow
                        ._sourceIndex
            ) {
                group.rowsByDate.set(
                    date,
                    {
                        ...row,
                        date,
                        cardId,
                        _sourceIndex:
                            sourceIndex
                    }
                );
            }
        }
    );

    return [...groups.values()]
        .map(group => ({
            printingKey:
                group.printingKey,

            nomCarte:
                group.nomCarte,

            edition:
                group.edition,

            version:
                group.version || null,

            langue:
                group.langue,

            historySource:
    group.historySource,

owned:
    group.owned,

            cardIds:
    [...group.cardIds]
        .sort(
            (a, b) =>
                String(a).localeCompare(
                    String(b),
                    "en",
                    {
                        numeric: true,
                        sensitivity: "base"
                    }
                )
        ),

            quantity:
                group.cardIds.size,

            rows:
                [...group.rowsByDate
                    .values()]
                    .sort(
                        (a, b) =>
                            String(a.date)
                                .localeCompare(
                                    String(b.date)
                                )
                    )
                    .map(row => {
                        const {
                            _sourceIndex,
                            ...cleanRow
                        } = row;

                        return cleanRow;
                    })
        }))
        .sort((a, b) => {
            const nameComparison =
                String(a.nomCarte)
                    .localeCompare(
                        String(b.nomCarte),
                        "fr",
                        {
                            sensitivity:
                                "base"
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
                            sensitivity:
                                "base"
                        }
                    );

            if (
                editionComparison !== 0
            ) {
                return editionComparison;
            }

            const languageComparison =
                String(a.langue)
                    .localeCompare(
                        String(b.langue),
                        "fr",
                        {
                            sensitivity:
                                "base"
                        }
                    );

            if (
                languageComparison !== 0
            ) {
                return languageComparison;
            }

            return String(
                a.version || ""
            ).localeCompare(
                String(b.version || ""),
                "fr",
                {
                    sensitivity: "base"
                }
            );
        });
}

function buildConditionSeries(
    printingGroup,
    condition
) {
    const normalizedCondition =
        String(condition || "")
            .toUpperCase();

    return (
        printingGroup?.rows || []
    )
        .map(row => {
            const price =
                getConditionPrice(
                    row,
                    normalizedCondition
                );

            if (
                price === null ||
                price <= 0
            ) {
                return null;
            }

            return {
                date:
                    normalizeDate(
                        row.date
                    ),

                price,

                condition:
                    normalizedCondition,

                confidence:
                    getConfidence(row),

                pricingModel:
                    row.pricingModel ||
                    null,

                gradeModelSource:
                    row.gradeModelSource ||
                    null,

                modelFamily:
    getModelFamily(row),

                observationDaysCount:
                    Number(
                        row
                            .observationDaysCount ||
                        0
                    ),

                observationRowsCount:
                    Number(
                        row
                            .observationRowsCount ||
                        0
                    ),

                marketAnchorPrice:
                    Number(
                        row
                            .marketAnchorPrice ||
                        0
                    ) || null,

                referenceMarketAnchorPrice:
                    Number(
                        row
                            .referenceMarketAnchorPrice ||
                        0
                    ) || null,

                pricingRatio:
                    Number.isFinite(
                        Number(
                            row.pricingRatio
                        )
                    )
                        ? Number(
                            row.pricingRatio
                        )
                        : null
            };
        })
        .filter(Boolean);
}

function detectStructuralBreak(
    previousRow,
    currentRow
) {
    if (!previousRow || !currentRow) {
        return null;
    }

    const reasons = [];

    if (
        previousRow.modelFamily !==
        currentRow.modelFamily
    ) {
        reasons.push(
            "model_family_changed"
        );
    }

    if (
        Number(
            currentRow.observationDaysCount ||
            0
        ) >
        Number(
            previousRow.observationDaysCount ||
            0
        )
    ) {
        reasons.push(
            "observation_days_increased"
        );
    }

    const previousConfidence =
        Number(previousRow.confidence);

    const currentConfidence =
        Number(currentRow.confidence);

    if (
        Number.isFinite(previousConfidence) &&
        Number.isFinite(currentConfidence) &&
        Math.abs(
            currentConfidence -
            previousConfidence
        ) >= 10
    ) {
        reasons.push(
            "confidence_jump"
        );
    }

    const ratioChange =
        relativeRatioChange(
            previousRow.pricingRatio,
            currentRow.pricingRatio
        );

    if (
        ratioChange !== null &&
        ratioChange >= 1.5
    ) {
        reasons.push(
            "pricing_ratio_jump"
        );
    }

    /*
     * Un saut de prix très important peut signaler
     * une recalibration même si les métadonnées
     * historiques sont incomplètes.
     *
     * Il ne suffit pas à lui seul : il doit être
     * accompagné d'au moins un autre changement.
     */
    const priceChange =
        relativeRatioChange(
            previousRow.price,
            currentRow.price
        );

    if (
        priceChange !== null &&
        priceChange >= 1.75 &&
        reasons.length > 0
    ) {
        reasons.push(
            "price_level_jump"
        );
    }

    if (!reasons.length) {
        return null;
    }

    return {
        date:
            currentRow.date,

        previousDate:
            previousRow.date,

        reasons,

        previousModelFamily:
            previousRow.modelFamily,

        currentModelFamily:
            currentRow.modelFamily,

        previousConfidence:
            previousRow.confidence,

        currentConfidence:
            currentRow.confidence,

        previousObservationDays:
            previousRow.observationDaysCount,

        currentObservationDays:
            currentRow.observationDaysCount,

        previousPricingRatio:
            previousRow.pricingRatio,

        currentPricingRatio:
            currentRow.pricingRatio,

        previousPrice:
            previousRow.price,

        currentPrice:
            currentRow.price
    };
}

function findStructuralBreaks(series) {
    const breaks = [];

    for (
        let index = 1;
        index < series.length;
        index += 1
    ) {
        const detected =
            detectStructuralBreak(
                series[index - 1],
                series[index]
            );

        if (detected) {
            breaks.push(detected);
        }
    }

    return breaks;
}

function getStableSeries(series) {
    if (!series.length) {
        return {
            structuralBreaks: [],
            lastStructuralBreak: null,
            stableRows: [],
            stableSince: null
        };
    }

    const structuralBreaks =
        findStructuralBreaks(series);

    const lastStructuralBreak =
        structuralBreaks.length
            ? structuralBreaks[
                structuralBreaks.length - 1
            ]
            : null;

    const stableRows =
        lastStructuralBreak
            ? series.filter(
                row =>
                    row.date >=
                    lastStructuralBreak.date
            )
            : [...series];

    return {
        structuralBreaks,

        lastStructuralBreak,

        stableRows,

        stableSince:
            stableRows[0]?.date ||
            null
    };
}


function buildPrintingConditionSeries(
    history,
    options = {}
) {
    const {
        startDate = null,
        conditions = CONDITIONS
    } = options;

    const groups =
        groupHistoryByPrinting(
            history,
            {
                startDate
            }
        );

    const series = [];

    groups.forEach(group => {
        conditions.forEach(
            condition => {
                const rows =
    buildConditionSeries(
        group,
        condition
    );

if (!rows.length) {
    return;
}

const stableAnalysis =
    getStableSeries(rows);

series.push({
                    printingKey:
                        group.printingKey,

                    nomCarte:
                        group.nomCarte,

                    edition:
                        group.edition,

                    version:
                        group.version,

                    langue:
                        group.langue,

                    historySource:
    group.historySource,

owned:
    group.owned,

                    cardIds:
                        group.cardIds,

                    quantity:
                        group.quantity,

                    condition:
                        String(condition)
                            .toUpperCase(),

                    firstDate:
                        rows[0].date,

                    latestDate:
                        rows[
                            rows.length - 1
                        ].date,

                    historyPoints:
    rows.length,

stableSince:
    stableAnalysis.stableSince,

stableHistoryPoints:
    stableAnalysis
        .stableRows
        .length,

structuralBreakCount:
    stableAnalysis
        .structuralBreaks
        .length,

lastStructuralBreak:
    stableAnalysis
        .lastStructuralBreak,

structuralBreaks:
    stableAnalysis
        .structuralBreaks,

rows,

stableRows:
    stableAnalysis
        .stableRows
                });
            }
        );
    });

    return series;
}

module.exports = {
    CONDITIONS,
    normalizeText,
    normalizeDate,
    parseEstimatedByCondition,
    getConditionPrice,
    getConfidence,
    getModelFamily,
    getHistoryEntityId,
    relativeRatioChange,
    buildPrintingKey,
    groupHistoryByPrinting,
    buildConditionSeries,
    detectStructuralBreak,
    findStructuralBreaks,
    getStableSeries,
    buildPrintingConditionSeries
};