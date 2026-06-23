let portfolioDataCache = null;

async function loadPortfolioData() {
    if (!portfolioDataCache) {
        const response = await fetch("data/portfolio.json");
        if (!response.ok) {
            throw new Error("Impossible de charger data/portfolio.json");
        }
        portfolioDataCache = await response.json();
    }
    return portfolioDataCache;
}

const originalFetch = window.fetch.bind(window);

window.fetch = async function(resource, options) {
    const url = typeof resource === "string" ? resource : resource.url;

    if (!url.startsWith("/api/")) {
        return originalFetch(resource, options);
    }

    const data = await loadPortfolioData();

    let payload;

    if (url === "/api/cards") {
        payload = data.cards;
    } else if (url === "/api/category-summary") {
        payload = data.categorySummary;
    } else if (url === "/api/portfolio-history") {
        payload = data.portfolioHistory;
    } else if (url === "/api/portfolio-summary") {
        payload = data.portfolioSummary;
    } else if (url === "/api/top-movers") {
        payload = data.topMovers;
    } else if (url === "/api/opportunities") {
        payload = data.opportunities;
    } else if (url.startsWith("/api/card-detail/")) {
        const id = Number(url.split("/").pop());
        payload = data.cardDetails[String(id)];
    } else {
        return new Response(
            JSON.stringify({ error: "Route statique inconnue" }),
            { status: 404, headers: { "Content-Type": "application/json" } }
        );
    }

    return new Response(JSON.stringify(payload), {
        status: 200,
        headers: { "Content-Type": "application/json" }
    });
};