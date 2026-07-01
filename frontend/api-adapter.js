async function fetchJson(path) {
    const response = await fetch(path);

    if (!response.ok) {
        throw new Error(`Erreur chargement ${path}`);
    }

    return response.json();
}

async function fetchFromPortfolioJson(key) {
    const data = await fetchJson("data/portfolio.json");
    return data[key];
}

window.apiAdapter = {
    async getCards() {
        try {
            const data = await fetchJson("data/cards.json");
            return data.cards || [];
        } catch {
            return fetchFromPortfolioJson("cards");
        }
    },

    async getWatchlist() {
        try {
            const data = await fetchJson("data/watchlist.json");
            return data.watchlistCards || [];
        } catch {
            return fetchFromPortfolioJson("watchlistCards");
        }
    },

    async getOpportunities() {
        try {
            const data = await fetchJson("data/opportunities.json");
            return data.opportunities || [];
        } catch {
            return fetchFromPortfolioJson("opportunities");
        }
    },

    async getCardDetails() {
        try {
            const data = await fetchJson("data/card-details.json");
            return data.cardDetails || {};
        } catch {
            return fetchFromPortfolioJson("cardDetails");
        }
    },

    async getCardDetail(cardId) {
        const details = await this.getCardDetails();
        return details[String(cardId)];
    },

    async getPortfolioSummary() {
        try {
            const data = await fetchJson("data/portfolio-summary.json");
            return data.portfolioSummary || {};
        } catch {
            return fetchFromPortfolioJson("portfolioSummary");
        }
    },

    async getPortfolioHistory() {
        try {
            const data = await fetchJson("data/portfolio-history.json");
            return data.portfolioHistory || [];
        } catch {
            return fetchFromPortfolioJson("portfolioHistory");
        }
    },

    async getCategorySummary() {
        try {
            const data = await fetchJson("data/category-summary.json");
            return data.categorySummary || [];
        } catch {
            return fetchFromPortfolioJson("categorySummary");
        }
    },

    async getTopMovers() {
        try {
            const data = await fetchJson("data/top-movers.json");
            return data.topMovers || [];
        } catch {
            return fetchFromPortfolioJson("topMovers");
        }
    }
};