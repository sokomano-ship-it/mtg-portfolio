async function fetchJson(path) {
    const response = await fetch(path, {
        cache: "no-store"
    });

    if (!response.ok) {
        throw new Error(`Erreur chargement ${path}`);
    }

    return response.json();
}

window.apiAdapter = {

    async getCards() {
        const data = await fetchJson("data/cards.json");
        return data.cards || [];
    },

    async getWatchlist() {
        const data = await fetchJson("data/watchlist.json");
        return data.watchlistCards || [];
    },

    async getOpportunities() {
        const data = await fetchJson("data/opportunities.json");
        return data.opportunities || [];
    },

    async getRadar() {
        const data = await fetchJson("data/radar.json");

        return {
            rows: data.rows || [],
            summary: data.summary || {},
            generatedAt: data.generatedAt || null,
            historyStartDate:
                data.historyStartDate || null,
            methodology:
                data.methodology || {}
        };
    },

    async getCardDetails() {
    const data = await fetchJson("data/card-details.json");
    return data.cardDetails || {};
},

async getEstimatedPriceHistory() {
    if (!this._estimatedPriceHistory) {
        this._estimatedPriceHistory =
            await fetchJson("data/estimated-price-history.json");
    }

    return Array.isArray(this._estimatedPriceHistory)
        ? this._estimatedPriceHistory
        : [];
},

async getCardDetail(cardId) {

    const [detail, estimatedPriceHistory] =
        await Promise.all([
            fetchJson(
                `data/card-details/${encodeURIComponent(cardId)}.json`
            ),
            this.getEstimatedPriceHistory()
        ]);

    if (!detail) {
        return null;
    }

    const card =
        detail.card || {};

    const condition =
        String(card.etat || "NM").toUpperCase();

    const estimatedHistory =
        estimatedPriceHistory
            .filter(row =>
                String(row.cardId) === String(cardId)
            )
            .map(row => {

                const estimatedByCondition =
                    row.estimatedByCondition &&
                    typeof row.estimatedByCondition === "object"
                        ? row.estimatedByCondition
                        : null;

                const estimatedConditionPrice =
                    estimatedByCondition?.[condition] ??
                    row.estimatedPrice ??
                    null;

                return {
                    ...row,
                    etat: card.etat,
                    estimatedByCondition,
                    estimatedConditionPrice,
                    estimatedPrice:
                        estimatedConditionPrice
                };
            })
            .sort((a, b) =>
                String(a.date).localeCompare(
                    String(b.date)
                )
            );

    return {
        ...detail,
        estimatedHistory
    };
},

    async getPortfolioSummary() {
        const data = await fetchJson("data/portfolio-summary.json");
        return data.portfolioSummary || {};
    },

    async getPortfolioHistory() {
        const data = await fetchJson("data/portfolio-history.json");
        return data.portfolioHistory || [];
    },

    async getCategorySummary() {
        const data = await fetchJson("data/category-summary.json");
        return data.categorySummary || [];
    },

    async getTopMovers() {
        const data = await fetchJson("data/top-movers.json");
        return data.topMovers || [];
    },

    async getInvestmentAnalysis() {
        const data = await fetchJson("data/investment-analysis.json");
        return data.investmentAnalysis || [];
    }
};