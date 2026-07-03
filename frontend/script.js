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
        allCards = await window.apiAdapter.getCards();

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
        const categories = await window.apiAdapter.getCategorySummary();

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
        const summary = await window.apiAdapter.getPortfolioSummary();

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

                <td>${escapeHtml(card.edition)}</td>
                <td>${escapeHtml(card.langue)}</td>
                <td>${escapeHtml(card.etat)}</td>
                <td>${escapeHtml(card.categorie || "Non classé")}</td>

                <td class="price">
                    <strong>${card.estimatedPrice ? formatEuro(card.estimatedPrice) : "-"}</strong>
                </td>

                <td>
                    ${
                        card.pricingConfidence !== null &&
                        card.pricingConfidence !== undefined
                            ? `${card.pricingConfidence} %`
                            : "-"
                    }
                </td>

                <td>${card.trendPrice ? formatEuro(card.trendPrice) : "-"}</td>
                <td>${card.avg30 ? formatEuro(card.avg30) : "-"}</td>
                <td>${card.avg7 ? formatEuro(card.avg7) : "-"}</td>
                <td>${card.avg1 ? formatEuro(card.avg1) : "-"}</td>

                <td class="links">
                    ${
                        scryfallUrl
                            ? `<a href="${scryfallUrl}" target="_blank">Scryfall</a>`
                            : ""
                    }
                </td>
            </tr>
        `;
    });
}

async function loadPortfolioHistory() {
    const history = await window.apiAdapter.getPortfolioHistory();
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
        allMovers = await window.apiAdapter.getTopMovers();

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
        allOpportunities = await window.apiAdapter.getOpportunities();

        status.textContent =
            `${allOpportunities.length} lignes affichées`;

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

function compactDecision(decision, score) {
    const value = Number(score || 0);
    const text = String(decision || "");

    if (value >= 85 || text.includes("Conviction")) return "🟢 Acheter";
    if (value >= 70 || text.includes("sélectif")) return "🟡 Surveiller";
    if (value >= 55) return "🔵 Possible";

    return "⚪ Attendre";
}

function getDecisionClass(decision, score) {
    const value = Number(score || 0);
    const text = String(decision || "");

    if (value >= 85 || text.includes("Conviction")) return "decision-buy";
    if (value >= 70 || text.includes("sélectif")) return "decision-watch";
    if (value >= 55) return "decision-possible";

    return "decision-neutral";
}

function getBuyingAction(card) {
    const discount = Number(card.discountPct || 0);
    const score = Number(card.buyProbability || 0);

    if (discount <= -15 && score >= 75) return "⭐ Exceptionnel";
    if (discount <= -10 && score >= 65) return "🟢 Acheter";
    if (discount <= -5 && score >= 55) return "🟡 Observer";

    return "⚪ Attendre";
}

function getBuyingActionClass(card) {
    const action = getBuyingAction(card);

    if (action.includes("Exceptionnel")) return "decision-buy";
    if (action.includes("Acheter")) return "decision-buy";
    if (action.includes("Observer")) return "decision-watch";

    return "decision-neutral";
}

function getMomentumLabel(card) {
    const momentum = Number(card.momentumQuality || 0);
    const avg1Vs7 = Number(card.avg1Vs7 || 0);
    const trendVs30 = Number(card.trendVs30 || 0);

    if (momentum >= 80 || avg1Vs7 >= 8) return "🚀 Forte hausse";
    if (momentum >= 65 || avg1Vs7 >= 4) return "📈 Hausse";
    if (momentum >= 50 || trendVs30 >= 0) return "👀 À surveiller";

    return "➖ Neutre";
}

function getMomentumClass(card) {
    const momentum = Number(card.momentumQuality || 0);
    const avg1Vs7 = Number(card.avg1Vs7 || 0);

    if (momentum >= 80 || avg1Vs7 >= 8) return "momentum-strong";
    if (momentum >= 65 || avg1Vs7 >= 4) return "momentum-up";
    if (momentum >= 50) return "momentum-watch";

    return "momentum-neutral";
}

function getBuyingAction(card) {
    const score = Number(card.buyProbability || 0);
    const timing = Number(card.timingScore || 0);
    const momentum = Number(card.momentumQuality || 0);

    if (score >= 85 && timing >= 80) return "🟢 Acheter";
    if (score >= 75 && momentum >= 70) return "🟢 Acheter";
    if (score >= 65 && momentum >= 55) return "🟡 Surveiller";
    if (score >= 55) return "🔵 Possible";

    return "⚪ Attendre";
}

function getBuyingActionClass(card) {
    const action = getBuyingAction(card);

    if (action.includes("Acheter")) return "decision-buy";
    if (action.includes("Surveiller")) return "decision-watch";
    if (action.includes("Possible")) return "decision-possible";

    return "decision-neutral";
}

function formatOpportunityExplanation(value) {
    if (!value) return "-";

    if (typeof value === "string") {
        return escapeHtml(value);
    }

    if (Array.isArray(value)) {
        return value
            .map(item => {
                if (typeof item === "string") return `• ${escapeHtml(item)}`;

                if (typeof item === "object" && item !== null) {
                    return `• ${escapeHtml(
                        item.label ||
                        item.text ||
                        item.reason ||
                        item.message ||
                        JSON.stringify(item)
                    )}`;
                }

                return `• ${escapeHtml(String(item))}`;
            })
            .join("<br>");
    }

    if (typeof value === "object") {
        return escapeHtml(
            value.label ||
            value.text ||
            value.reason ||
            value.message ||
            JSON.stringify(value)
        );
    }

    return escapeHtml(String(value));
}

function formatDiscount(value) {
    const number = Number(value || 0);
    return `${number >= 0 ? "+" : ""}${number.toFixed(1)} %`;
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
        <td>
            <button class="card-link-button" onclick="openOpportunityDetail('${escapeHtml(String(card.id))}')">
                <strong>${escapeHtml(card.nomCarte || "-")}</strong>
            </button>
            <div class="opportunity-subline">
                ${escapeHtml(card.ownedStates && card.ownedStates !== "-" ? `Possédé : ${card.ownedStates}` : "")}
            </div>
        </td>

        <td>${escapeHtml(card.edition || "-")}</td>
        <td>${escapeHtml(card.langue || "-")}</td>

        <td>
            <span class="${card.owned ? "owned-yes" : "owned-no"}">
                ${card.owned ? "Oui" : "Non"}
            </span>
        </td>

        <td class="price">${formatEuro(card.nmPrice || card.trendPrice)}</td>
        <td class="price"><strong>${formatEuro(card.nmTargetPrice)}</strong></td>
        <td class="price"><strong>${formatEuro(card.exTargetPrice)}</strong></td>

        <td>
            <span class="${getMomentumClass(card)}">
                ${getMomentumLabel(card)}
            </span>
        </td>

        <td>
            <span class="${getBuyingActionClass(card)}" title="${escapeHtml(card.explanation || "")}">
                ${getBuyingAction(card)}
            </span>
        </td>
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






function closeCardDetail() {
    const modal = document.getElementById("card-detail-modal");
    if (modal) {
        modal.classList.remove("visible");
    }
}


async function openCardDetail(cardId) {
    try {
        const detail = await window.apiAdapter.getCardDetail(cardId);

if (!detail) {
    throw new Error("Impossible de charger le détail de la carte");
}

        const card = detail.card;
        const history = detail.history || [];
        const estimatedHistory = detail.estimatedHistory || [];
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

        const sourceHistory = estimatedHistory.length ? estimatedHistory : history;
        const chartHistory = deduplicateHistoryByDate(sourceHistory);

        renderCardDetailChart(chartHistory);
    } catch (error) {
        console.error(error);
        alert(error.message);
    }
}

function openOpportunityDetail(opportunityId) {
    const card = allOpportunities.find(row => String(row.id) === String(opportunityId));

    if (!card) {
        alert("Impossible de charger le détail de l'opportunité");
        return;
    }

    const modal = document.getElementById("card-detail-modal");
    const title = document.getElementById("detail-title");
    const image = document.getElementById("detail-image");
    const info = document.getElementById("detail-info");

    title.textContent = card.nomCarte;

    image.innerHTML = card.imageUrl
        ? `<img src="${card.imageUrl}" alt="${escapeHtml(card.nomCarte)}">`
        : "";

    info.innerHTML = `
        <p><strong>Édition :</strong> ${escapeHtml(card.edition || "-")}</p>
        <p><strong>Langue :</strong> ${escapeHtml(card.langue || "-")}</p>
        <p><strong>Possédé :</strong> ${escapeHtml(card.ownedLabel || "Non")}</p>
        <p><strong>États possédés :</strong> ${escapeHtml(card.ownedStates || "-")}</p>

        <hr>

        <p><strong>Prix marché :</strong> ${formatEuro(card.nmPrice || card.trendPrice)}</p>
        <p><strong>Prix max NM :</strong> ${formatEuro(card.nmTargetPrice)}</p>
        <p><strong>Prix max EX :</strong> ${formatEuro(card.exTargetPrice)}</p>

        <hr>

        <p><strong>Trend :</strong> ${formatEuro(card.trendPrice)}</p>
        <p><strong>Avg1 :</strong> ${formatEuro(card.avg1)}</p>
        <p><strong>Avg7 :</strong> ${formatEuro(card.avg7)}</p>
        <p><strong>Avg30 :</strong> ${formatEuro(card.avg30)}</p>
        <p><strong>Trend vs Avg30 :</strong> ${formatPercent(card.trendVs30)}</p>
        <p><strong>Avg1 vs Avg7 :</strong> ${formatPercent(card.avg1Vs7)}</p>

        <hr>

        <p><strong>Momentum :</strong> ${getMomentumLabel(card)} (${Number(card.momentumQuality || 0)} %)</p>
        <p><strong>Tendance :</strong> ${Number(card.trendQuality || 0)} %</p>
        <p><strong>Timing :</strong> ${Number(card.timingScore || 0)} %</p>
        <p><strong>Potentiel :</strong> ${Number(card.remainingPotential || 0)} %</p>
        <p><strong>Risque :</strong> ×${Number(card.riskMultiplier || 0)}</p>
        <p><strong>Score achat :</strong> ${Number(card.buyProbability || 0)} %</p>

        <hr>

        <p><strong>Action :</strong> ${getBuyingAction(card)}</p>
        <p><strong>Explication :</strong><br>${formatOpportunityExplanation(card.explanation)}</p>
    `;

    modal.classList.add("visible");

    const history = Array.isArray(card.historical?.history)
        ? deduplicateHistoryByDate(card.historical.history)
        : [];

    renderCardDetailChart(history);
}

let cardDetailChart = null;

function renderCardDetailChart(history) {
    const ctx = document.getElementById("cardDetailChart");
    if (!ctx) return;

    if (cardDetailChart) {
        cardDetailChart.destroy();
    }

    if (!Array.isArray(history) || history.length === 0) {
    if (cardDetailChart) {
        cardDetailChart.destroy();
        cardDetailChart = null;
    }
    return;
}

    const isEstimatedHistory = history.some(row => row.estimatedPrice !== undefined);

    cardDetailChart = new Chart(ctx, {
        type: "line",
        data: {
            labels: history.map(row => row.date),
            datasets: [
                {
                    label: isEstimatedHistory ? "Prix estimé V2 (€)" : "Trend marché (€)",
                    data: history.map(row => row.estimatedPrice ?? row.trendPrice),
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

function deduplicateHistoryByDate(history) {
    const byDate = new Map();

    history.forEach(row => {
        if (!row.date) return;
        byDate.set(row.date, row);
    });

    return [...byDate.values()].sort((a, b) =>
        String(a.date).localeCompare(String(b.date))
    );
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