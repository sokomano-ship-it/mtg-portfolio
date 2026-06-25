function buildExplanation(reasons, warnings) {
    return [
        ...reasons.map(text => ({
            type: "positive",
            text
        })),
        ...warnings.map(text => ({
            type: "warning",
            text
        }))
    ];
}

module.exports = buildExplanation;