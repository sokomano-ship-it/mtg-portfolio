let allCards = [];
let allMovers = [];
let allOpportunities = [];

let currentMoverSort = "perf30d";
let currentMoverDirection = "desc";

let currentOpportunitySort = "buyProbability";

let currentOpportunityDirection = "desc";

let currentCollectionSort = "nomCarte";
let currentCollectionDirection = "asc";

document.addEventListener("DOMContentLoaded", () => {
    setupTabs();
    loadDashboard();
});

function setupTabs() {
    document.querySelectorAll(".tab-button").forEach(button => {
        button.addEventListener("click", () => {
            const target = button.dataset.tab;

            document.querySelectorAll(".tab-button").forEach(b => {
                b.classList.remove("active");
            });

            document.querySelectorAll(".tab-content").forEach(tab => {
                tab.classList.remove("active");
            });

            button.classList.add("active");
            document.getElementById(target).classList.add("active");
        });
    });
}

async function loadDashboard() {
    await loadCards();
    await loadPortfolioSummary();
    await loadPortfolioHistory();
    await loadCategorySummary();
    await loadTopMovers();
    await loadOpportunities();
}

async function loadCards() {
    const status = document.getElementById("status");
    const totalCards = document.getElementById("total-cards");
    const totalValue = document.getElementById("total-value");

    try {
        const response = await fetch("/api/cards");
        if (!response.ok) throw new Error("Impossible de charger la collection");

        allCards = await response.json();

        status.textContent = `${allCards.length} cartes chargées`;
        totalCards.textContent = allCards.length;
        totalValue.textContent = formatEuro(calculateCardsValue(allCards));

        populateCategories(allCards);
        setupCollectionFilters();
        setupCollectionSorting();
        filterCards();
    } catch (error) {
        console.error(error);
        status.textContent = "Erreur : " + error.message;
    }
}

async function loadCategorySummary() {
    const tbody = document.getElementById("category-summary-body");
    if (!tbody) return;

    try {
        const response = await fetch("/api/category-summary");
        if (!response.ok) throw new Error("Impossible de charger le résumé par catégorie");

        const categories = await response.json();

        tbody.innerHTML = "";

        categories.forEach(row => {
            tbody.innerHTML += `
                <tr>
                    <td><strong>${escapeHtml(row.categorie)}</strong></td>
                    <td>${row.cardsCount}</td>
                    <td class="price">${formatEuro(row.totalValue)}</td>
                </tr>
            `;
        });
    } catch (error) {
        console.error(error);
        tbody.innerHTML = `
            <tr>
                <td colspan="3">Erreur : ${escapeHtml(error.message)}</td>
            </tr>
        `;
    }
}

async function loadPortfolioSummary() {
    const change = document.getElementById("portfolio-change");
    const changePct = document.getElementById("portfolio-change-pct");

    if (!change || !changePct) return;

    try {
        const response = await fetch("/api/portfolio-summary");
        if (!response.ok) throw new Error("Impossible de charger le résumé portefeuille");

        const summary = await response.json();

        change.textContent = formatSignedEuro(summary.change);
        changePct.textContent = formatPercent(summary.changePct);

        change.className = Number(summary.change) >= 0 ? "score-positive" : "score-negative";
        changePct.className = Number(summary.changePct) >= 0 ? "score-positive" : "score-negative";
    } catch (error) {
        console.error(error);
        change.textContent = "-";
        changePct.textContent = "-";
    }
}

function populateCategories(cards) {
    const select = document.getElementById("category-filter");
    if (!select) return;

    select.innerHTML = `<option value="Toutes">Toutes</option>`;

    const categories = [...new Set(
        cards.map(card => card.categorie || "Non classé")
    )].sort();

    categories.forEach(category => {
        const option = document.createElement("option");
        option.value = category;
        option.textContent = category;
        select.appendChild(option);
    });

    select.removeEventListener("change", filterCards);
    select.addEventListener("change", filterCards);
}

function setupCollectionFilters() {
    document.querySelectorAll(".collection-filter").forEach(input => {
        input.removeEventListener("input", filterCards);
        input.addEventListener("input", filterCards);
    });
}

function setupCollectionSorting() {
    document.querySelectorAll(".collection-sortable").forEach(header => {
        header.onclick = () => {
            const newSort = header.dataset.sort;

            if (newSort === currentCollectionSort) {
                currentCollectionDirection =
                    currentCollectionDirection === "asc" ? "desc" : "asc";
            } else {
                currentCollectionSort = newSort;
                currentCollectionDirection = "desc";
            }

            filterCards();
        };
    });
}

function getCollectionFilters() {
    const filters = {};

    document.querySelectorAll(".collection-filter").forEach(input => {
        const key = input.dataset.filter;
        const value = input.value.trim();

        if (key && value) {
            filters[key] = value;
        }
    });

    return filters;
}

function filterCards() {
    const select = document.getElementById("category-filter");
    const filters = getCollectionFilters();

    let cards = [...allCards];

    if (select && select.value !== "Toutes") {
        cards = cards.filter(card =>
            (card.categorie || "Non classé") === select.value
        );
    }

    cards = cards.filter(card =>
        Object.entries(filters).every(([key, value]) =>
            matchesCollectionFilter(card, key, value)
        )
    );

    sortCollectionCards(cards);
    updateCollectionHeaderState();
    updateCategoryStats(cards);
    renderCards(cards);
}

function sortCollectionCards(cards) {
    const numericColumns = [
    "estimatedPrice",
    "pricingConfidence",
    "trendPrice",
    "avg30",
    "avg7",
    "avg1",
    "lowPrice",
    "avgPrice"
];

    cards.sort((a, b) => {
        const aValue =
            currentCollectionSort === "categorie"
                ? (a.categorie || "Non classé")
                : a[currentCollectionSort];

        const bValue =
            currentCollectionSort === "categorie"
                ? (b.categorie || "Non classé")
                : b[currentCollectionSort];

        if (aValue === null || aValue === undefined) return 1;
        if (bValue === null || bValue === undefined) return -1;

        if (numericColumns.includes(currentCollectionSort)) {
            const result = Number(aValue || 0) - Number(bValue || 0);
            return currentCollectionDirection === "asc" ? result : -result;
        }

        const result = String(aValue || "").localeCompare(
            String(bValue || ""),
            "fr",
            { sensitivity: "base" }
        );

        return currentCollectionDirection === "asc" ? result : -result;
    });
}

function updateCollectionHeaderState() {
    document.querySelectorAll(".collection-sortable").forEach(header => {
        header.classList.remove("active-sort", "sort-asc", "sort-desc");

        if (header.dataset.sort === currentCollectionSort) {
            header.classList.add("active-sort");
            header.classList.add(
                currentCollectionDirection === "asc" ? "sort-asc" : "sort-desc"
            );
        }
    });
}

function matchesCollectionFilter(card, key, value) {
    const numericKeys = [
    "estimatedPrice",
    "pricingConfidence",
    "trendPrice",
    "avg30",
    "avg7",
    "avg1",
    "lowPrice",
    "avgPrice"
];

    if (numericKeys.includes(key)) {
        return matchesNumericFilter(Number(card[key] || 0), value);
    }

    const fieldValue =
        key === "categorie"
            ? String(card.categorie || "Non classé")
            : String(card[key] || "");

    return normalizeText(fieldValue).includes(normalizeText(value));
}

function matchesNumericFilter(number, filter) {
    const value = String(filter || "")
        .replace(",", ".")
        .replace("€", "")
        .trim();

    if (!value) return true;

    const rangeMatch = value.match(/^(\d+(\.\d+)?)\s*-\s*(\d+(\.\d+)?)$/);
    if (rangeMatch) {
        return number >= Number(rangeMatch[1]) && number <= Number(rangeMatch[3]);
    }

    const greaterOrEqualMatch = value.match(/^>=\s*(\d+(\.\d+)?)$/);
    if (greaterOrEqualMatch) return number >= Number(greaterOrEqualMatch[1]);

    const lowerOrEqualMatch = value.match(/^<=\s*(\d+(\.\d+)?)$/);
    if (lowerOrEqualMatch) return number <= Number(lowerOrEqualMatch[1]);

    const greaterMatch = value.match(/^>\s*(\d+(\.\d+)?)$/);
    if (greaterMatch) return number > Number(greaterMatch[1]);

    const lowerMatch = value.match(/^<\s*(\d+(\.\d+)?)$/);
    if (lowerMatch) return number < Number(lowerMatch[1]);

    const exactNumber = Number(value);
    if (!Number.isNaN(exactNumber)) {
        return Math.abs(number - exactNumber) < 0.005;
    }

    return true;
}

function updateCategoryStats(cards) {
    const count = document.getElementById("category-count");
    const value = document.getElementById("category-value");

    if (count) count.textContent = cards.length;
    if (value) value.textContent = formatEuro(calculateCardsValue(cards));
}

function calculateCardsValue(cards) {
    return cards.reduce((sum, card) => {
        return sum + (Number(card.estimatedPrice ?? card.prixEtat) || 0);
    }, 0);
}

function renderCards(cards) {
    const tbody = document.getElementById("cards-body");
    if (!tbody) return;

    tbody.innerHTML = "";

    cards.forEach(card => {
        const scryfallUrl = card.scryfallId
            ? `https://scryfall.com/card/${card.scryfallId}`
            : null;

        tbody.innerHTML += `
            <tr>
                <td>
                    ${
                        card.imageUrl
                            ? `<img src="${card.imageUrl}" alt="${escapeHtml(card.nomCarte)}" class="card-image">`
                            : `<span class="muted">Aucune image</span>`
                    }
                </td>

                <td>
                    <button class="card-link-button" onclick="openCardDetail(${card.id})">
                        ${escapeHtml(card.nomCarte)}
                    </button>
                </td>

                <td>${card.version ? escapeHtml(card.version) : "-"}</td>
                <td>${escapeHtml(card.edition)}</td>
                <td>${escapeHtml(card.langue)}</td>
                <td>${escapeHtml(card.etat)}</td>
                <td>${escapeHtml(card.categorie || "Non classé")}</td>

<td class="price"><strong>${card.estimatedPrice ? formatEuro(card.estimatedPrice) : "-"}</strong></td>
<td>${card.pricingConfidence !== null && card.pricingConfidence !== undefined ? `${card.pricingConfidence} %` : "-"}</td>

<td>${card.trendPrice ? formatEuro(card.trendPrice) : "-"}</td>
<td>${card.avg30 ? formatEuro(card.avg30) : "-"}</td>
<td>${card.avg7 ? formatEuro(card.avg7) : "-"}</td>
<td>${card.avg1 ? formatEuro(card.avg1) : "-"}</td>
                <td class="links">
                    ${scryfallUrl ? `<a href="${scryfallUrl}" target="_blank">Scryfall</a>` : ""}
                </td>
            </tr>
        `;
    });
}

async function loadPortfolioHistory() {
    const response = await fetch("/api/portfolio-history");
    if (!response.ok) return;

    const history = await response.json();
    const ctx = document.getElementById("portfolioChart");
    if (!ctx) return;

    new Chart(ctx, {
        type: "line",
        data: {
            labels: history.map(row => row.date),
            datasets: [
                {
                    label: "Valeur estimée portefeuille (€)",
data: history.map(row => row.totalValue),
                    tension: 0.3
                }
            ]
        },
        options: {
            responsive: true,
            plugins: {
                legend: {
                    labels: { color: "#f5f5f5" }
                }
            },
            scales: {
                x: {
                    ticks: { color: "#f5f5f5" },
                    grid: { color: "rgba(255,255,255,0.1)" }
                },
                y: {
                    ticks: { color: "#f5f5f5" },
                    grid: { color: "rgba(255,255,255,0.1)" }
                }
            }
        }
    });
}

async function loadTopMovers() {
    const status = document.getElementById("movers-status");
    if (!status) return;

    try {
        const response = await fetch("/api/top-movers");
        if (!response.ok) throw new Error("Impossible de charger les variations");

        allMovers = await response.json();

        status.textContent = `${allMovers.length} lignes analysées`;

        document.querySelectorAll(".sortable:not(.collection-sortable):not(.opportunity-sortable)").forEach(header => {
            header.onclick = () => {
                const newSort = header.dataset.sort;

                if (newSort === currentMoverSort) {
                    currentMoverDirection =
                        currentMoverDirection === "asc" ? "desc" : "asc";
                } else {
                    currentMoverSort = newSort;
                    currentMoverDirection = "desc";
                }

                renderTopMovers();
            };
        });

        renderTopMovers();
    } catch (error) {
        console.error(error);
        status.textContent = "Erreur : " + error.message;
    }
}

function renderTopMovers() {
    const tbody = document.getElementById("movers-body");
    if (!tbody) return;

    const sortedMovers = [...allMovers].sort((a, b) => {
        const getValue = card => {
            if (currentMoverSort === "lotValue") {
                return (Number(card.currentPrice) || 0) *
                    (Number(card.quantity) || 1);
            }

            return card[currentMoverSort];
        };

        return compareValues(
            getValue(a),
            getValue(b),
            currentMoverDirection
        );
    });

    tbody.innerHTML = "";

    sortedMovers.forEach(card => {
        const quantity = Number(card.quantity || 1);
        const lotValue = (Number(card.currentPrice) || 0) * quantity;

        tbody.innerHTML += `
            <tr>
                <td><strong>${escapeHtml(card.nomCarte)}</strong></td>
                <td>${escapeHtml(card.edition)}</td>
                <td>${escapeHtml(card.etat || "-")}</td>
                <td>${quantity}</td>
                <td class="price">${formatEuro(card.currentPrice)}</td>
                <td class="price">${formatEuro(lotValue)}</td>
                <td class="${performanceClass(card.perf7d)}">${formatOptionalPercent(card.perf7d)}</td>
                <td class="${performanceClass(card.perf30d)}">${formatOptionalPercent(card.perf30d)}</td>
                <td class="${performanceClass(card.perf90d)}">${formatOptionalPercent(card.perf90d)}</td>
                <td class="${performanceClass(card.perf180d)}">${formatOptionalPercent(card.perf180d)}</td>
                <td class="${performanceClass(card.perf365d)}">${formatOptionalPercent(card.perf365d)}</td>
            </tr>
        `;
    });

    updateMoverHeaderState();
}

function updateMoverHeaderState() {
    document
        .querySelectorAll(".sortable:not(.collection-sortable):not(.opportunity-sortable)")
        .forEach(header => {
            header.classList.remove("active-sort", "sort-asc", "sort-desc");

            if (header.dataset.sort === currentMoverSort) {
                header.classList.add("active-sort");
                header.classList.add(
                    currentMoverDirection === "asc" ? "sort-asc" : "sort-desc"
                );
            }
        });
}

async function loadOpportunities() {
    const status = document.getElementById("opportunities-status");
    if (!status) return;

    try {
        const response = await fetch("/api/opportunities");
        if (!response.ok) throw new Error("Impossible de charger les opportunités");

        allOpportunities = await response.json();

        status.textContent =
            `${allOpportunities.length} lignes affichées : top 30 scores + 10 plus mauvais scores`;

        setupOpportunitySorting();
        renderOpportunities();
    } catch (error) {
        console.error(error);
        status.textContent = "Erreur : " + error.message;
    }
}

function setupOpportunitySorting() {
    document.querySelectorAll(".opportunity-sortable").forEach(header => {
        header.onclick = () => {
            const newSort = header.dataset.sort;

            if (newSort === currentOpportunitySort) {
                currentOpportunityDirection =
                    currentOpportunityDirection === "asc" ? "desc" : "asc";
            } else {
                currentOpportunitySort = newSort;
                currentOpportunityDirection = "desc";
            }

            renderOpportunities();
        };
    });
}

function renderOpportunities() {
    const tbody = document.getElementById("opportunities-body");
    if (!tbody) return;

    const sorted = [...allOpportunities].sort((a, b) => {
        return compareValues(
            a[currentOpportunitySort],
            b[currentOpportunitySort],
            currentOpportunityDirection
        );
    });

    tbody.innerHTML = "";

    sorted.forEach(card => {
        const reasons = Array.isArray(card.reasons)
            ? card.reasons.map(reason => "✅ " + escapeHtml(reason)).join("<br>")
            : "";

        const warnings = Array.isArray(card.warnings)
            ? card.warnings.map(warning => "⚠️ " + escapeHtml(warning)).join("<br>")
            : "";

        const details = [reasons, warnings].filter(Boolean).join("<br>");

        tbody.innerHTML += `
            <tr>
                <td><strong>${escapeHtml(card.nomCarte || "-")}</strong></td>
                <td>${escapeHtml(card.edition || "-")}</td>
                <td>${escapeHtml(card.version || "-")}</td>
                <td>${escapeHtml(card.langue || "-")}</td>

                <td>${escapeHtml(card.ownedLabel || "-")}</td>
                <td>${Number(card.quantityOwned || 0)}</td>
                <td>${escapeHtml(card.ownedStates || "-")}</td>

                <td class="price">${formatEuro(card.nmPrice || card.trendPrice)}</td>
                <td class="price">${formatEuro(card.avg7)}</td>
                <td class="price">${formatEuro(card.avg30)}</td>

                <td class="${performanceClass(card.trendVs30)}">${formatPercent(card.trendVs30)}</td>
                <td class="${performanceClass(card.avg1Vs7)}">${formatPercent(card.avg1Vs7)}</td>

                <td>
                    <strong>${Number(card.buyProbability || 0)} %</strong><br>
                    <span class="muted">${escapeHtml(card.decision || "")}</span>
                </td>

                <td><strong>${Number(card.timingScore || 0)} %</strong></td>
                <td><strong>${Number(card.remainingPotential || 0)} %</strong></td>

                <td>
                    <span class="muted">
                        Tendance ${Number(card.trendQuality || 0)} %<br>
                        Momentum ${Number(card.momentumQuality || 0)} %<br>
                        Risque ×${Number(card.riskMultiplier || 0)}
                    </span>
                </td>

                <td>${details || "-"}</td>
            </tr>
        `;
    });

    updateOpportunityHeaderState();
}

function updateOpportunityHeaderState() {
    document.querySelectorAll(".opportunity-sortable").forEach(header => {
        header.classList.remove("active-sort", "sort-asc", "sort-desc");

        if (header.dataset.sort === currentOpportunitySort) {
            header.classList.add("active-sort");
            header.classList.add(
                currentOpportunityDirection === "asc" ? "sort-asc" : "sort-desc"
            );
        }
    });
}

function compareValues(aValue, bValue, direction) {
    if (aValue === null || aValue === undefined) return 1;
    if (bValue === null || bValue === undefined) return -1;

    if (typeof aValue === "string" || typeof bValue === "string") {
        const result = String(aValue).localeCompare(
            String(bValue),
            "fr",
            { sensitivity: "base" }
        );

        return direction === "asc" ? result : -result;
    }

    const result = Number(aValue) - Number(bValue);
    return direction === "asc" ? result : -result;
}

async function openCardDetail(cardId) {
    try {
        const response = await fetch(`/api/card-detail/${cardId}`);

        if (!response.ok) {
            throw new Error("Impossible de charger le détail de la carte");
        }

        const detail = await response.json();

        const card = detail.card;
        const history = detail.history || [];
        const performance = detail.performance || {};

        const modal = document.getElementById("card-detail-modal");
        const title = document.getElementById("detail-title");
        const image = document.getElementById("detail-image");
        const info = document.getElementById("detail-info");

        title.textContent = card.nomCarte;

        image.innerHTML = card.imageUrl
            ? `<img src="${card.imageUrl}" alt="${escapeHtml(card.nomCarte)}">`
            : "";

        info.innerHTML = `
            <p><strong>Edition :</strong> ${escapeHtml(card.edition)}</p>
            <p><strong>Etat :</strong> ${escapeHtml(card.etat)}</p>
            <p><strong>Catégorie :</strong> ${escapeHtml(card.categorie || "Non classé")}</p>
<p><strong>Estimation V2 :</strong> ${formatEuro(card.estimatedPrice)}</p>
<p><strong>Confiance :</strong> ${card.pricingConfidence ?? "-"} %</p>
<p><strong>Modèle :</strong> ${escapeHtml(card.pricingModel || "-")}</p>
<p><strong>Trend :</strong> ${formatEuro(card.trendPrice)}</p>
<p><strong>Avg30 :</strong> ${formatEuro(card.avg30)}</p>
<p><strong>Avg7 :</strong> ${formatEuro(card.avg7)}</p>
<p><strong>Avg1 :</strong> ${formatEuro(card.avg1)}</p>
            <div class="detail-performances">
                <span>7j : ${formatOptionalPercent(performance.perf7d)}</span>
                <span>30j : ${formatOptionalPercent(performance.perf30d)}</span>
                <span>90j : ${formatOptionalPercent(performance.perf90d)}</span>
                <span>180j : ${formatOptionalPercent(performance.perf180d)}</span>
                <span>365j : ${formatOptionalPercent(performance.perf365d)}</span>
            </div>
        `;

        modal.classList.add("visible");

        renderCardDetailChart(history);
    } catch (error) {
        console.error(error);
        alert(error.message);
    }
}

let cardDetailChart = null;

function renderCardDetailChart(history) {
    const ctx = document.getElementById("cardDetailChart");
    if (!ctx) return;

    if (cardDetailChart) {
        cardDetailChart.destroy();
    }

    cardDetailChart = new Chart(ctx, {
        type: "line",
        data: {
            labels: history.map(row => row.date),
            datasets: [
                {
                    label: "Prix état (€)",
                    data: history.map(row => row.trendPrice),
                    tension: 0.3
                }
            ]
        },
        options: {
            responsive: true,
            plugins: {
                legend: {
                    labels: { color: "#f5f5f5" }
                }
            },
            scales: {
                x: {
                    ticks: { color: "#f5f5f5" },
                    grid: { color: "rgba(255,255,255,0.1)" }
                },
                y: {
                    ticks: { color: "#f5f5f5" },
                    grid: { color: "rgba(255,255,255,0.1)" }
                }
            }
        }
    });
}

function closeCardDetail() {
    const modal = document.getElementById("card-detail-modal");
    if (modal) {
        modal.classList.remove("visible");
    }
}

function performanceClass(value) {
    if (value === null || value === undefined) return "muted";
    return Number(value) >= 0 ? "score-positive" : "score-negative";
}

function getSignalClass(signal) {
    if (!signal) {
        return "muted";
    }

    signal = String(signal);

    if (signal.includes("Conviction achat")) {
        return "signal-strong";
    }

    if (signal.includes("Achat sélectif")) {
        return "signal-up";
    }

    if (
        signal.includes("À surveiller") ||
        signal.includes("Surveillance") ||
        signal.includes("surveiller")
    ) {
        return "signal-watch";
    }

    if (signal.includes("Neutre")) {
        return "muted";
    }

    return "muted";
}

function getConfidenceClass(score) {
    const value = Number(score || 0);

    if (value >= 80) {
        return "signal-strong";
    }

    if (value >= 60) {
        return "signal-up";
    }

    if (value >= 40) {
        return "muted";
    }

    return "score-negative";
}

function formatEuro(value) {
    return new Intl.NumberFormat("fr-FR", {
        style: "currency",
        currency: "EUR"
    }).format(Number(value) || 0);
}

function formatSignedEuro(value) {
    const number = Number(value) || 0;
    const formatted = formatEuro(Math.abs(number));

    return `${number >= 0 ? "+" : "-"}${formatted}`;
}

function formatPercent(value) {
    const number = Number(value) || 0;
    return `${number >= 0 ? "+" : ""}${number.toFixed(2)} %`;
}

function formatOptionalPercent(value) {
    if (value === null || value === undefined) return "-";
    return formatPercent(value);
}

function normalizeText(value) {
    return String(value || "")
        .toLowerCase()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .trim();
}

function escapeHtml(value) {
    return String(value ?? "")
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#039;");
}