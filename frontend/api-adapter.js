

async function fetchJson(path) {
    const response = await fetch(path, { cache: "no-store" });

    if (!response.ok) {
        throw new Error(`Erreur chargement ${path}`);
    }

    return response.json();
}

window.apiAdapter = {
    async getCards() {
    const data = await fetchJson("/api/cards");
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

    async getCardDetails() {
    const data = await fetchJson("/api/card-details");
    return data.cardDetails || {};
},

    async getCardDetail(cardId) {
        const details = await this.getCardDetails();
        return details[String(cardId)];
    },

    async getPortfolioSummary() {
    const data = await fetchJson("/api/portfolio-summary");
    return data.portfolioSummary || {};
},

    async getPortfolioHistory() {
    const data = await fetchJson("/api/portfolio-history");
    return data.portfolioHistory || [];
}

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