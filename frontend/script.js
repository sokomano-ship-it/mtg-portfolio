let allCards = [];
let allMovers = [];
let allOpportunities = [];
let allInvestmentAnalysis = [];
let selectedInvestmentCardId = null;

let currentInvestmentSort = "perf30d";
let currentInvestmentDirection = "desc";

let currentMoverSort = "perf30d";
let currentMoverDirection = "desc";

let currentOpportunitySort = "opportunityScore";

let currentOpportunityDirection = "desc";

let currentCollectionSort = "nomCarte";
let currentCollectionDirection = "asc";
let investmentChart = null;
let portfolioChart = null;

let portfolioChartPeriod = "daily";
let portfolioChartResizeTimer = null;
let currentPortfolioChartRenderer = null;
let selectedPortfolioCategory = "";
let selectedPortfolioEdition = "";
let selectedPortfolioCardKey = "";

let portfolioCardSuggestionMap = new Map();

const PORTFOLIO_CHART_MAX_POINTS = 500;
const PORTFOLIO_CHART_MIN_POINTS = 60;
const PORTFOLIO_CHART_PIXELS_PER_POINT = 4;
let opportunitiesLoaded = false;
let investmentLoaded = false;
let moversLoaded = false;
let collectionLoaded = false;

const MODEL_START_DATE = "2026-07-12";
document.addEventListener("DOMContentLoaded", () => {
    setupTabs();
    setupInvestmentDrawerTabs();
    loadDashboard();
});

function getPortfolioCategories() {

    return [...new Set(

        allCards
            .map(card => String(card.categorie || "").trim())
            .filter(Boolean)

    )].sort((a,b)=>

        a.localeCompare(
            b,
            "fr",
            { sensitivity:"base" }
        )

    );

}

function getPortfolioEditions() {

    return [...new Set(

        allCards
            .map(card => String(card.edition || "").trim())
            .filter(Boolean)

    )].sort((a,b)=>

        a.localeCompare(
            b,
            "fr",
            { sensitivity:"base" }
        )

    );

}



function buildPortfolioChartFilters() {
    const categorySelect = document.getElementById(
        "portfolio-category-filter"
    );

    const editionSelect = document.getElementById(
        "portfolio-edition-filter"
    );

    if (!categorySelect || !editionSelect) {
        return;
    }

    const previousCategory =
        categorySelect.value || selectedPortfolioCategory;

    const previousEdition =
        editionSelect.value || selectedPortfolioEdition;

    categorySelect.innerHTML = `
        <option value="">
            Toutes les catégories
        </option>
    `;

    getPortfolioCategories().forEach(category => {
        const option = document.createElement("option");

        option.value = category;
        option.textContent = category;

        categorySelect.appendChild(option);
    });

    editionSelect.innerHTML = `
        <option value="">
            Toutes les éditions
        </option>
    `;

    getPortfolioEditions().forEach(edition => {
        const option = document.createElement("option");

        option.value = edition;
        option.textContent = edition;

        editionSelect.appendChild(option);
    });

    const availableCategories = [
        ...categorySelect.options
    ].map(option => option.value);

    const availableEditions = [
        ...editionSelect.options
    ].map(option => option.value);

    selectedPortfolioCategory =
        availableCategories.includes(previousCategory)
            ? previousCategory
            : "";

    selectedPortfolioEdition =
        availableEditions.includes(previousEdition)
            ? previousEdition
            : "";

    categorySelect.value =
        selectedPortfolioCategory;

    editionSelect.value =
        selectedPortfolioEdition;
}


function handlePortfolioMainFilterChange() {
    selectedPortfolioCategory =
        document.getElementById(
            "portfolio-category-filter"
        )?.value || "";

    selectedPortfolioEdition =
        document.getElementById(
            "portfolio-edition-filter"
        )?.value || "";

    selectedPortfolioCardKey = "";

    const cardSearch = document.getElementById(
        "portfolio-card-search"
    );

    const clearButton = document.getElementById(
        "portfolio-clear-card"
    );

    if (cardSearch) {
        cardSearch.value = "";
    }

    if (clearButton) {
        clearButton.hidden = true;
    }

    rebuildPortfolioCardSuggestions();

    console.log(
        "Portfolio filters",
        selectedPortfolioCategory,
        selectedPortfolioEdition
    );
}

function setupPortfolioChartFilterEvents() {

    document
        .getElementById("portfolio-category-filter")
        ?.addEventListener(
            "change",
            handlePortfolioMainFilterChange
        );

    document
        .getElementById("portfolio-edition-filter")
        ?.addEventListener(
            "change",
            handlePortfolioMainFilterChange
        );

}

function getCardsMatchingPortfolioFilters() {
    return allCards.filter(card => {
        const category =
            String(card.categorie || "").trim();

        const edition =
            String(card.edition || "").trim();

        const categoryMatches =
            !selectedPortfolioCategory ||
            category === selectedPortfolioCategory;

        const editionMatches =
            !selectedPortfolioEdition ||
            edition === selectedPortfolioEdition;

        return categoryMatches && editionMatches;
    });
}

function getPortfolioCardKey(card) {
    return [
        card.nomCarte || "",
        card.edition || "",
        card.langue || "",
        card.etat || ""
    ].join("||");
}

function rebuildPortfolioCardSuggestions() {
    const datalist = document.getElementById(
        "portfolio-card-suggestions"
    );

    if (!datalist) {
        return;
    }

    portfolioCardSuggestionMap.clear();
    datalist.innerHTML = "";

    const uniqueCards = new Map();

    getCardsMatchingPortfolioFilters().forEach(card => {
        const key = getPortfolioCardKey(card);

        if (!uniqueCards.has(key)) {
            uniqueCards.set(key, card);
        }
    });

    const cards = [...uniqueCards.values()].sort((a, b) => {
        const nameComparison = String(
            a.nomCarte || ""
        ).localeCompare(
            String(b.nomCarte || ""),
            "fr",
            { sensitivity: "base" }
        );

        if (nameComparison !== 0) {
            return nameComparison;
        }

        return String(a.edition || "").localeCompare(
            String(b.edition || ""),
            "fr",
            { sensitivity: "base" }
        );
    });

    cards.forEach(card => {
        const key = getPortfolioCardKey(card);

        const label = [
            card.nomCarte,
            card.edition,
            card.langue,
            card.etat
        ]
            .filter(Boolean)
            .join(" — ");

        const option = document.createElement("option");

        option.value = label;

        datalist.appendChild(option);

        portfolioCardSuggestionMap.set(label, {
            key,
            card
        });
    });
}

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

            const targetTab = document.getElementById(target);

            if (targetTab) {
                targetTab.classList.add("active");
            }

            if (
                target === "tab-collection" &&
                !collectionLoaded
            ) {
                collectionLoaded = true;
                filterCards();
            }

            if (
                target === "tab-opportunities" &&
                !opportunitiesLoaded
            ) {
                opportunitiesLoaded = true;
                loadOpportunities();
            }

            if (
                target === "tab-investment-analysis" &&
                !investmentLoaded
            ) {
                investmentLoaded = true;
                loadInvestmentAnalysis();
            }

            if (
                target === "tab-top-movers" &&
                !moversLoaded
            ) {
                moversLoaded = true;
                loadTopMovers();
            }
        });
    });
}

function setupInvestmentDrawerTabs() {
    document.querySelectorAll(".investment-drawer-tab").forEach(button => {
        button.addEventListener("click", () => {
            const target = button.dataset.investmentPanel;

            document.querySelectorAll(".investment-drawer-tab").forEach(tab => {
                tab.classList.remove("active");
            });

            document.querySelectorAll(".investment-drawer-panel").forEach(panel => {
                panel.classList.remove("active");
            });

            button.classList.add("active");

            const panel = document.getElementById(`investment-panel-${target}`);
            if (panel) {
                panel.classList.add("active");
            }
        });
    });
}

async function loadDashboard() {
    /*
     * Toutes les requêtes démarrent immédiatement.
     * L'historique reste en attente pendant le chargement des cartes,
     * car le graphique utilise allCards pour calculer la valeur du jour.
     */
    const cardsPromise = loadCards();

    

    const portfolioHistoryPromise =
        window.apiAdapter.getPortfolioHistory();

    const categorySummaryPromise =
        loadCategorySummary();

    /*
     * Il faut que allCards soit rempli avant de construire le graphique.
     */
    await cardsPromise;

    await Promise.all([
    categorySummaryPromise,
    loadPortfolioHistory(portfolioHistoryPromise)
]);
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

buildPortfolioChartFilters();
setupPortfolioChartFilterEvents();
rebuildPortfolioCardSuggestions();

setupCollectionFilters();
setupCollectionSorting();


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
    "estimatedByCondition",
    "gradeModelConfidence",
    "observationDaysCount",
    "trendPrice",
    "avg30",
    "avg7",
    "avg1",
    "lowPrice",
    "avgPrice"
];


    cards.sort((a, b) => {
        const aValue =
    currentCollectionSort === "estimatedByCondition"
        ? getEstimatedConditionPrice(a)
        : currentCollectionSort === "categorie"
            ? (a.categorie || "Non classé")
            : a[currentCollectionSort];

const bValue =
    currentCollectionSort === "estimatedByCondition"
        ? getEstimatedConditionPrice(b)
        : currentCollectionSort === "categorie"
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
    "estimatedByCondition",
    "gradeModelConfidence",
    "observationDaysCount",
    "trendPrice",
    "avg30",
    "avg7",
    "avg1",
    "lowPrice",
    "avgPrice"
];

    if (numericKeys.includes(key)) {
        const number =
    key === "estimatedByCondition"
        ? getEstimatedConditionPrice(card)
        : card[key];

return matchesNumericFilter(Number(number || 0), value);
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
        return sum + (Number(getEstimatedConditionPrice(card)) || 0);
    }, 0);
}

function getEstimatedConditionPrice(card) {
    const condition = String(card.etat || "").toUpperCase();

    if (
        card.estimatedByCondition &&
        typeof card.estimatedByCondition === "object"
    ) {
        return (
            card.estimatedByCondition[condition] ??
            card.estimatedByCondition.NM ??
            card.estimatedPrice ??
            card.avg30 ??
            card.trendPrice ??
            null
        );
    }

    return (
        card.estimatedByCondition ??
        card.estimatedPrice ??
        card.avg30 ??
        card.trendPrice ??
        null
    );
}

function renderCards(cards) {
    const tbody = document.getElementById("cards-body");
    if (!tbody) return;

    const rowsHtml = cards.map(card => {
        const scryfallUrl = card.scryfallId
            ? `https://scryfall.com/card/${card.scryfallId}`
            : null;

        const estimatedPrice =
            getEstimatedConditionPrice(card);

        return `
            <tr>
                <td>
                    ${
                        card.imageUrl
                            ? `
                                <img
                                    src="${escapeHtml(card.imageUrl)}"
                                    alt="${escapeHtml(card.nomCarte)}"
                                    class="card-image"
                                    loading="lazy"
                                    decoding="async"
                                >
                            `
                            : `<span class="muted">Aucune image</span>`
                    }
                </td>

                <td>
                    <button
                        class="card-link-button"
                        onclick="openCardDetail(${card.id})"
                    >
                        ${escapeHtml(card.nomCarte)}
                    </button>
                </td>

                <td>${escapeHtml(card.edition)}</td>
                <td>${escapeHtml(card.langue)}</td>
                <td>${escapeHtml(card.etat)}</td>
                <td>${escapeHtml(card.categorie || "Non classé")}</td>

                <td class="price">
                    <strong>
                        ${
                            estimatedPrice !== null &&
                            estimatedPrice !== undefined
                                ? formatEuro(estimatedPrice)
                                : "-"
                        }
                    </strong>
                </td>

                <td>
                    ${
                        card.gradeModelConfidence !== null &&
                        card.gradeModelConfidence !== undefined
                            ? `${card.gradeModelConfidence} %`
                            : "-"
                    }
                </td>

                <td>
                    ${card.trendPrice
                        ? formatEuro(card.trendPrice)
                        : "-"
                    }
                </td>

                <td>
                    ${card.avg30
                        ? formatEuro(card.avg30)
                        : "-"
                    }
                </td>

                <td>
                    ${card.avg7
                        ? formatEuro(card.avg7)
                        : "-"
                    }
                </td>

                <td>
                    ${card.avg1
                        ? formatEuro(card.avg1)
                        : "-"
                    }
                </td>

                <td class="links">
                    ${
                        scryfallUrl
                            ? `
                                <a
                                    href="${escapeHtml(scryfallUrl)}"
                                    target="_blank"
                                    rel="noopener noreferrer"
                                >
                                    Scryfall
                                </a>
                            `
                            : ""
                    }
                </td>
            </tr>
        `;
    }).join("");

    tbody.innerHTML = rowsHtml;
}

function getResponsiveChartPointLimit(canvas) {
    const chartWidth =
        canvas?.parentElement?.clientWidth ||
        canvas?.clientWidth ||
        window.innerWidth ||
        800;

    return Math.min(
        PORTFOLIO_CHART_MAX_POINTS,
        Math.max(
            PORTFOLIO_CHART_MIN_POINTS,
            Math.floor(
                chartWidth /
                PORTFOLIO_CHART_PIXELS_PER_POINT
            )
        )
    );
}

function getIsoWeekKey(dateString) {
    const date = new Date(
        `${String(dateString).slice(0, 10)}T12:00:00Z`
    );

    if (Number.isNaN(date.getTime())) {
        return String(dateString);
    }

    const target = new Date(date);

    const dayNumber =
        (target.getUTCDay() + 6) % 7;

    target.setUTCDate(
        target.getUTCDate() -
        dayNumber +
        3
    );

    const firstThursday = new Date(
        Date.UTC(
            target.getUTCFullYear(),
            0,
            4
        )
    );

    const firstDayNumber =
        (firstThursday.getUTCDay() + 6) % 7;

    firstThursday.setUTCDate(
        firstThursday.getUTCDate() -
        firstDayNumber +
        3
    );

    const weekNumber =
        1 +
        Math.round(
            (
                target.getTime() -
                firstThursday.getTime()
            ) /
            (
                7 *
                24 *
                60 *
                60 *
                1000
            )
        );

    return [
        target.getUTCFullYear(),
        `W${String(weekNumber).padStart(2, "0")}`
    ].join("-");
}

function getHistoryPeriodKey(dateString, period) {
    const normalizedDate =
        String(dateString).slice(0, 10);

    if (period === "weekly") {
        return getIsoWeekKey(normalizedDate);
    }

    if (period === "monthly") {
        return normalizedDate.slice(0, 7);
    }

    return normalizedDate;
}

function aggregateHistoryByPeriod(rows, period) {
    if (period === "daily") {
        return [...rows];
    }

    const latestRowByPeriod = new Map();

    rows.forEach(row => {
        if (!row?.date) return;

        const periodKey =
            getHistoryPeriodKey(
                row.date,
                period
            );

        /*
         * Les lignes sont classées par date.
         * La dernière valeur de chaque période
         * remplace donc les précédentes.
         */
        latestRowByPeriod.set(
            periodKey,
            row
        );
    });

    return [
        ...latestRowByPeriod.values()
    ];
}

function prepareResponsiveChartRows(
    rows,
    period,
    canvas
) {
    const aggregatedRows =
        aggregateHistoryByPeriod(
            rows,
            period
        );

    const maximumPoints =
        getResponsiveChartPointLimit(
            canvas
        );

    return aggregatedRows.slice(
        -maximumPoints
    );
}

function formatPortfolioChartDate(
    dateString,
    period
) {
    const date = new Date(
        `${String(dateString).slice(0, 10)}T12:00:00`
    );

    if (Number.isNaN(date.getTime())) {
        return String(dateString);
    }

    if (period === "monthly") {
        return new Intl.DateTimeFormat(
            "fr-FR",
            {
                month: "short",
                year: "numeric"
            }
        ).format(date);
    }

    if (period === "weekly") {
        return new Intl.DateTimeFormat(
            "fr-FR",
            {
                day: "2-digit",
                month: "short",
                year: "2-digit"
            }
        ).format(date);
    }

    return new Intl.DateTimeFormat(
        "fr-FR",
        {
            day: "2-digit",
            month: "short"
        }
    ).format(date);
}

function setupPortfolioChartPeriodButtons(
    renderChart
) {
    document
        .querySelectorAll(
            "[data-portfolio-period]"
        )
        .forEach(button => {
            button.onclick = () => {
                portfolioChartPeriod =
                    button.dataset
                        .portfolioPeriod ||
                    "daily";

                document
                    .querySelectorAll(
                        "[data-portfolio-period]"
                    )
                    .forEach(periodButton => {
                        periodButton.classList.toggle(
                            "active",
                            periodButton === button
                        );
                    });

                renderChart();
            };
        });
}

function setupPortfolioChartResize(
    renderChart
) {
    currentPortfolioChartRenderer =
        renderChart;

    if (
        window
            .__portfolioChartResizeBound
    ) {
        return;
    }

    window.__portfolioChartResizeBound =
        true;

    window.addEventListener(
        "resize",
        () => {
            clearTimeout(
                portfolioChartResizeTimer
            );

            portfolioChartResizeTimer =
                setTimeout(() => {
                    if (
                        currentPortfolioChartRenderer
                    ) {
                        currentPortfolioChartRenderer();
                    }
                }, 200);
        }
    );
}

async function loadPortfolioHistory(historyPromise = null) {
    const history = historyPromise
        ? await historyPromise
        : await window.apiAdapter.getPortfolioHistory();

    const ctx = document.getElementById("portfolioChart");
    const selector = document.getElementById(
        "portfolio-chart-selector"
    );

    if (!ctx) return;

    const filteredHistory = Array.isArray(history)
        ? history
            .filter(row =>
                row.date &&
                String(row.date).slice(0, 10) >= MODEL_START_DATE
            )
            .map(row => ({
                ...row,
                date: String(row.date).slice(0, 10),
                totalValue: Number(row.totalValue || 0),
                categoryValues:
                    row.categoryValues &&
                    typeof row.categoryValues === "object"
                        ? row.categoryValues
                        : {}
            }))
            .sort((a, b) =>
                String(a.date).localeCompare(String(b.date))
            )
        : [];

    /*
     * Valeur actuelle totale.
     */
    const currentTotal = Number(
        calculateCardsValue(allCards).toFixed(2)
    );

    const today = new Intl.DateTimeFormat("en-CA", {
        timeZone: "Europe/Paris",
        year: "numeric",
        month: "2-digit",
        day: "2-digit"
    }).format(new Date());

    /*
     * Calcul des catégories pour aujourd'hui uniquement.
     */
    const currentCategoryValues = {};

    allCards.forEach(card => {
        const category =
            card.categorie || "Non classé";

        const value =
            Number(getEstimatedConditionPrice(card)) || 0;

        currentCategoryValues[category] =
            (currentCategoryValues[category] || 0) + value;
    });

    Object.keys(currentCategoryValues).forEach(category => {
        currentCategoryValues[category] = Number(
            currentCategoryValues[category].toFixed(2)
        );
    });

    /*
     * Met à jour uniquement la ligne affichée pour aujourd'hui.
     * Cela ne modifie pas le fichier JSON.
     */
    const todayRow = filteredHistory.find(
        row => row.date === today
    );

    if (todayRow) {
        todayRow.totalValue = currentTotal;
        todayRow.categoryValues = currentCategoryValues;
    } else {
        filteredHistory.push({
            date: today,
            totalValue: currentTotal,
            categoryValues: currentCategoryValues
        });
    }

    filteredHistory.sort((a, b) =>
        String(a.date).localeCompare(String(b.date))
    );

    if (!filteredHistory.length) {
        return;
    }

    /*
     * Détection automatique de toutes les catégories disponibles.
     */
    const categories = [
        ...new Set(
            filteredHistory.flatMap(row =>
                Object.keys(row.categoryValues || {})
            )
        )
    ].sort((a, b) =>
        a.localeCompare(b, "fr", {
            sensitivity: "base"
        })
    );

    /*
     * Remplit le sélecteur sans perdre le choix actuel.
     */
    if (selector) {
        const previousValue =
            selector.value || "portfolio";

        selector.innerHTML = `
            <option value="portfolio">
                Portefeuille total
            </option>
        `;

        categories.forEach(category => {
            const option = document.createElement("option");

            option.value = `category:${category}`;
            option.textContent = category;

            selector.appendChild(option);
        });

        const availableValues = [
            ...selector.options
        ].map(option => option.value);

        selector.value = availableValues.includes(previousValue)
            ? previousValue
            : "portfolio";
    }

    function renderSelectedPortfolioChart() {
    const selectedValue =
        selector?.value || "portfolio";

    const totalCardsElement =
        document.getElementById("total-cards");

    const totalValueElement =
        document.getElementById("total-value");

    const changeElement =
        document.getElementById("portfolio-change");

    const changePctElement =
        document.getElementById("portfolio-change-pct");

    const totalCardsLabel =
        document.getElementById("total-cards-label");

    const totalValueLabel =
        document.getElementById("total-value-label");

    const changeLabel =
        document.getElementById("portfolio-change-label");

    const changePctLabel =
        document.getElementById(
            "portfolio-change-pct-label"
        );

    let label;
let currentCards;
let currentValue;
let displayName;
let getSelectedRowValue;

    /*
     * Portefeuille complet.
     */
    if (selectedValue === "portfolio") {
        displayName = "Portefeuille total";
        label = "Valeur estimée du portefeuille (€)";

        getSelectedRowValue = row =>
    Number(row.totalValue);

        currentCards = allCards.length;
        currentValue = currentTotal;

        if (totalCardsLabel) {
            totalCardsLabel.textContent =
                "Cartes totales";
        }

        if (totalValueLabel) {
            totalValueLabel.textContent =
                "Valeur estimée portefeuille";
        }
    } else {
        /*
         * Catégorie sélectionnée.
         */
        const category = selectedValue.replace(
            "category:",
            ""
        );

        displayName = category;
        label = `${category} (€)`;

        getSelectedRowValue = row => {
    const value =
        row.categoryValues?.[category];

    if (
        value === null ||
        value === undefined ||
        Number.isNaN(Number(value))
    ) {
        return null;
    }

    return Number(value);
};

        const selectedCards = allCards.filter(card =>
            (card.categorie || "Non classé") === category
        );

        currentCards = selectedCards.length;

        currentValue = Number(
            calculateCardsValue(selectedCards).toFixed(2)
        );

        if (totalCardsLabel) {
            totalCardsLabel.textContent =
                `Cartes — ${category}`;
        }

        if (totalValueLabel) {
            totalValueLabel.textContent =
                `Valeur estimée — ${category}`;
        }
    }

    /*
     * Recherche de la dernière valeur connue avant aujourd'hui.
     *
     * On ne prend pas nécessairement la ligne juste avant :
     * certaines anciennes lignes peuvent ne pas encore contenir
     * categoryValues.
     */
    let previousValue = null;

    for (
        let index = filteredHistory.length - 1;
        index >= 0;
        index -= 1
    ) {
        const row = filteredHistory[index];

        if (row.date >= today) {
            continue;
        }

        let candidateValue;

        if (selectedValue === "portfolio") {
            candidateValue = row.totalValue;
        } else {
            const category = selectedValue.replace(
                "category:",
                ""
            );

            candidateValue =
                row.categoryValues?.[category];
        }

        if (
            candidateValue !== null &&
            candidateValue !== undefined &&
            !Number.isNaN(Number(candidateValue))
        ) {
            previousValue = Number(candidateValue);
            break;
        }
    }

    /*
     * Calcul de la variation.
     */
    const change =
        previousValue === null
            ? null
            : Number(
                (currentValue - previousValue).toFixed(2)
            );

    const changePct =
        previousValue === null ||
        previousValue === 0
            ? null
            : Number(
                (
                    (change / previousValue) *
                    100
                ).toFixed(2)
            );

    /*
     * Mise à jour des quatre cartes.
     */
    if (totalCardsElement) {
        totalCardsElement.textContent =
            currentCards.toLocaleString("fr-FR");
    }

    if (totalValueElement) {
        totalValueElement.textContent =
            formatEuro(currentValue);
    }

    if (changeLabel) {
        changeLabel.textContent =
            selectedValue === "portfolio"
                ? "Variation depuis hier"
                : `Variation — ${displayName}`;
    }

    if (changePctLabel) {
        changePctLabel.textContent =
            selectedValue === "portfolio"
                ? "Variation %"
                : `Variation % — ${displayName}`;
    }

    if (changeElement) {
        if (change === null) {
            changeElement.textContent = "-";
            changeElement.className = "";
        } else {
            changeElement.textContent =
                formatSignedEuro(change);

            changeElement.className =
                change >= 0
                    ? "score-positive"
                    : "score-negative";
        }
    }

    if (changePctElement) {
        if (changePct === null) {
            changePctElement.textContent = "-";
            changePctElement.className = "";
        } else {
            changePctElement.textContent =
                formatPercent(changePct);

            changePctElement.className =
                changePct >= 0
                    ? "score-positive"
                    : "score-negative";
        }
    }


    /*
 * Agrégation quotidienne, hebdomadaire
 * ou mensuelle, puis limitation du nombre
 * de points selon la largeur du graphique.
 */
const visibleHistory =
    prepareResponsiveChartRows(
        filteredHistory,
        portfolioChartPeriod,
        ctx
    );

const data =
    visibleHistory.map(
        getSelectedRowValue
    );

    /*
     * Destruction de l'ancien graphique.
     */
    if (portfolioChart) {
        portfolioChart.destroy();
    }

    /*
     * Création du graphique correspondant à la sélection.
     */
    portfolioChart = new Chart(ctx, {
        type: "line",

        data: {
            labels: visibleHistory.map(row =>
    formatPortfolioChartDate(
        row.date,
        portfolioChartPeriod
    )
),

            datasets: [
                {
    label,
    data,
    tension: 0.3,
    spanGaps: false,
    fill: false,

    pointRadius:
        visibleHistory.length > 120
            ? 0
            : 2,

    pointHoverRadius: 5
}
            ]
        },

        options: {
            responsive: true,
            animation: false,

            interaction: {
                mode: "index",
                intersect: false
            },

            plugins: {
                legend: {
                    labels: {
                        color: "#f5f5f5"
                    }
                },

                tooltip: {
                    callbacks: {
                        label(context) {
                            const value =
                                context.parsed.y;

                            if (
                                value === null ||
                                value === undefined
                            ) {
                                return `${context.dataset.label} : -`;
                            }

                            return `${context.dataset.label} : ${formatEuro(value)}`;
                        }
                    }
                }
            },

            scales: {
                x: {
                    ticks: {
    color: "#f5f5f5",
    autoSkip: true,
    maxTicksLimit: 12,
    maxRotation: 0,
    minRotation: 0
},

                    grid: {
                        color:
                            "rgba(255,255,255,0.1)"
                    }
                },

                y: {
                    beginAtZero: false,

                    ticks: {
                        color: "#f5f5f5",

                        callback(value) {
                            return formatEuro(value);
                        }
                    },

                    grid: {
                        color:
                            "rgba(255,255,255,0.1)"
                    }
                }
            }
        }
    });
}
 // Branche le sélecteur portefeuille/deck.
if (selector) {
    selector.onchange =
        renderSelectedPortfolioChart;
}

/*
 * Branche les boutons Jours / Semaines / Mois.
 * Ils seront ajoutés dans index.html à l’étape suivante.
 */
setupPortfolioChartPeriodButtons(
    renderSelectedPortfolioChart
);

/*
 * Recalcule le nombre maximal de points
 * lorsque la largeur de la fenêtre change.
 */
setupPortfolioChartResize(
    renderSelectedPortfolioChart
);

// Premier affichage.
renderSelectedPortfolioChart();
}

async function loadInvestmentAnalysis() {
    const status = document.getElementById("investment-status");
    if (!status) return;

    try {
        allInvestmentAnalysis = await window.apiAdapter.getInvestmentAnalysis();

        status.textContent =
            `${allInvestmentAnalysis.length} lignes analysées`;

        document
            .querySelectorAll("#tab-investment-analysis .sortable")
            .forEach(header => {
                header.onclick = () => {
                    const newSort = header.dataset.sort;

                    if (newSort === currentInvestmentSort) {
                        currentInvestmentDirection =
                            currentInvestmentDirection === "asc" ? "desc" : "asc";
                    } else {
                        currentInvestmentSort = newSort;
                        currentInvestmentDirection = "desc";
                    }

                    renderInvestmentAnalysis();
                };
            });

        renderInvestmentAnalysis();
    } catch (error) {
        console.error(error);
        status.textContent = "Erreur : " + error.message;
    }
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

function renderInvestmentAnalysis() {
    const tbody = document.getElementById("investment-analysis-body");
    if (!tbody) return;

    const sortedRows = [...allInvestmentAnalysis].sort((a, b) => {
        return compareValues(
            a[currentInvestmentSort],
            b[currentInvestmentSort],
            currentInvestmentDirection
        );
    });

    tbody.innerHTML = "";

    sortedRows.forEach(card => {
        const scryfallUrl =
            card.scryfallUri ||
            (
                card.scryfallId
                    ? `https://scryfall.com/card/${card.scryfallId}`
                    : null
            );

        tbody.innerHTML += `
            <tr
                onclick="showInvestmentDetails(${card.id})"
                class="${
                    Number(selectedInvestmentCardId) === Number(card.id)
                        ? "selected-row"
                        : ""
                }"
                style="cursor:pointer;"
            >
                <td>
                    <strong>${escapeHtml(card.nomCarte || "-")}</strong>
                </td>

                <td>${escapeHtml(card.edition || "-")}</td>
                <td>${escapeHtml(card.langue || "-")}</td>
                <td>${escapeHtml(card.etat || "-")}</td>
                <td>${Number(card.quantity || 1)}</td>

                <td class="price">
                    ${formatEuro(card.currentEstimatedPrice)}
                </td>

                <td class="price">
                    <strong>${formatEuro(card.lotValue)}</strong>
                </td>

                <td class="${performanceClass(card.perf7d)}">
                    ${formatOptionalPercent(card.perf7d)}
                </td>

                <td class="${performanceClass(card.perf30d)}">
                    ${formatOptionalPercent(card.perf30d)}
                </td>

                <td class="${performanceClass(card.perf60d)}">
                    ${formatOptionalPercent(card.perf60d)}
                </td>

                <td class="${performanceClass(card.perf180d)}">
                    ${formatOptionalPercent(card.perf180d)}
                </td>

                <td class="${performanceClass(card.perf365d)}">
                    ${formatOptionalPercent(card.perf365d)}
                </td>

                <td>
                    ${
                        card.confidence !== null &&
                        card.confidence !== undefined
                            ? `${Number(card.confidence).toFixed(0)} %`
                            : "-"
                    }
                </td>

                <td class="links">
                    ${
                        scryfallUrl
                            ? `
                                <a
                                    href="${escapeHtml(scryfallUrl)}"
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    onclick="event.stopPropagation()"
                                >
                                    Scryfall
                                </a>
                            `
                            : "-"
                    }
                </td>
            </tr>
        `;
    });

    updateInvestmentHeaderState();
}

function openInvestmentDrawer() {
    const drawer = document.getElementById("investment-drawer");
    if (drawer) {
        drawer.classList.add("visible");
    }
}

function closeInvestmentDrawer() {
    const drawer = document.getElementById("investment-drawer");
    if (drawer) {
        drawer.classList.remove("visible");
    }
}

function calculateInvestmentScore(card) {
    const confidence = Number(card.confidence || 0);
    const observationDays = Number(card.observationDaysCount || 0);

    const confidenceScore = Math.min(confidence, 100);
    const observationScore = Math.min(observationDays * 10, 100);

    const performanceScore = Math.max(
        0,
        Math.min(
            100,
            50 + Number(card.perf30d || card.perf7d || 0)
        )
    );

    return Math.round(
        confidenceScore * 0.5 +
        observationScore * 0.25 +
        performanceScore * 0.25
    );
}

function formatStars(score) {
    const value = Number(score || 0);

    if (value >= 85) return "★★★★★";
    if (value >= 70) return "★★★★☆";
    if (value >= 55) return "★★★☆☆";
    if (value >= 40) return "★★☆☆☆";
    return "★☆☆☆☆";
}

function updateInvestmentDrawerHeader(card) {
    const title = document.getElementById("investment-drawer-title");
    const subtitle = document.getElementById("investment-drawer-subtitle");
    const score = document.getElementById("investment-drawer-score");

    const investmentScore = calculateInvestmentScore(card);

    if (title) {
        title.textContent = card.nomCarte || "-";
    }

    if (subtitle) {
        subtitle.textContent = `${card.edition || "-"} · ${card.langue || "-"} · ${card.etat || "-"} · Qté ${Number(card.quantity || 1)}`;
    }

    if (score) {
        score.innerHTML = `
            <strong>${formatStars(investmentScore)}</strong>
            <span>Score investissement : ${investmentScore} / 100</span>
        `;
    }
}

async function showInvestmentDetails(cardId) {
    selectedInvestmentCardId = cardId;
    renderInvestmentAnalysis();
    openInvestmentDrawer();

    const investmentCard = allInvestmentAnalysis.find(row =>
        Number(row.id) === Number(cardId)
    );

    if (!investmentCard) {
        console.error("Carte investissement introuvable :", cardId);
        return;
    }

    updateInvestmentDrawerHeader(investmentCard);

    const container = document.getElementById("investment-details");

    if (container) {
        container.innerHTML = `
            <h3>${escapeHtml(investmentCard.nomCarte || "-")}</h3>

            <p class="muted">
                ${escapeHtml(investmentCard.edition || "-")} ·
                ${escapeHtml(investmentCard.langue || "-")} ·
                ${escapeHtml(investmentCard.etat || "-")} ·
                Qté ${Number(investmentCard.quantity || 1)}
            </p>

            <div class="detail-performances">
                <span>
                    <strong>Prix modèle</strong><br>
                    ${formatEuro(investmentCard.currentEstimatedPrice)}
                </span>

                <span>
                    <strong>Valeur lot</strong><br>
                    ${formatEuro(investmentCard.lotValue)}
                </span>

                <span>
                    <strong>Confiance</strong><br>
                    ${
                        investmentCard.confidence !== null &&
                        investmentCard.confidence !== undefined
                            ? `${Number(investmentCard.confidence).toFixed(0)} %`
                            : "-"
                    }
                </span>

                <span>
                    <strong>Jours observés</strong><br>
                    ${investmentCard.observationDaysCount ?? "-"}
                </span>
            </div>

            <hr>

            <p>
                <strong>Performance :</strong><br>
                7j :
                <span class="${performanceClass(investmentCard.perf7d)}">
                    ${formatOptionalPercent(investmentCard.perf7d)}
                </span><br>

                30j :
                <span class="${performanceClass(investmentCard.perf30d)}">
                    ${formatOptionalPercent(investmentCard.perf30d)}
                </span><br>

                60j :
                <span class="${performanceClass(investmentCard.perf60d)}">
                    ${formatOptionalPercent(investmentCard.perf60d)}
                </span><br>

                180j :
                <span class="${performanceClass(investmentCard.perf180d)}">
                    ${formatOptionalPercent(investmentCard.perf180d)}
                </span><br>

                365j :
                <span class="${performanceClass(investmentCard.perf365d)}">
                    ${formatOptionalPercent(investmentCard.perf365d)}
                </span>
            </p>

            <hr>

            <p>
                <strong>Modèle :</strong>
                ${escapeHtml(investmentCard.pricingModel || "-")}<br>

                <strong>Source :</strong>
                ${escapeHtml(investmentCard.gradeModelSource || "-")}
            </p>
        `;
    }

    try {
        const detail = await window.apiAdapter.getCardDetail(cardId);
        const modelCard = detail?.card || {};

        renderInvestmentModelCards(modelCard);
        renderInvestmentChart(cardId);
    } catch (error) {
        console.error("Erreur chargement détail modèle :", error);
    }
}

function renderInvestmentModelCards(card) {
    if (!card) return;

    const condition =
        String(card.etat || "NM").toUpperCase();

    const priceContainer =
        document.getElementById("investment-model-price");

    const referenceContainer =
        document.getElementById("investment-model-reference");

    const weightsContainer =
        document.getElementById("investment-model-weights");

    const observationsContainer =
        document.getElementById("investment-model-observations");

    const ratiosContainer =
        document.getElementById("investment-model-ratios");

    const estimatedPrice =
        getEstimatedConditionPrice(card);

    const rawObservedPrice =
        card.observedMinByCondition?.[condition] ??
        null;

    const reliableObservedPrice =
        card.reliableObservedByCondition?.[condition] ??
        rawObservedPrice ??
        null;

    const reliability =
        card.observationReliabilityByCondition?.[condition] ??
        null;

    if (priceContainer) {
        priceContainer.innerHTML = `
            <div class="drawer-grid">
                <div>Prix estimé</div>
                <div>${formatOptionalEuro(estimatedPrice)}</div>

                <div>Trend Cardmarket</div>
                <div>${formatOptionalEuro(card.trendPrice)}</div>

                <div>Moyenne 30 jours</div>
                <div>${formatOptionalEuro(card.avg30)}</div>

                <div>Prix observé brut</div>
                <div>${formatOptionalEuro(rawObservedPrice)}</div>

                <div>Prix observé fiabilisé</div>
                <div>${formatOptionalEuro(reliableObservedPrice)}</div>

                <div>Fiabilité de l’état</div>
                <div>${formatReliability(reliability)}</div>

                <div>Confiance globale</div>
                <div>
                    ${
                        card.gradeModelConfidence !== null &&
                        card.gradeModelConfidence !== undefined
                            ? `${Number(card.gradeModelConfidence).toFixed(0)} %`
                            : "-"
                    }
                </div>
            </div>
        `;
    }

    if (referenceContainer) {
        const referenceType =
            card.usesExternalReference
                ? "Proxy externe"
                : "Même impression";

        const referenceRole =
            card.marketReferenceRole === "evolution_only"
                ? "Évolution uniquement"
                : card.marketReferenceRole === "level_and_evolution"
                    ? "Niveau et évolution"
                    : card.marketReferenceRole || "-";

        referenceContainer.innerHTML = `
            <div class="drawer-grid">
                <div>Type</div>
                <div>${escapeHtml(referenceType)}</div>

                <div>Carte</div>
                <div>${escapeHtml(card.referenceName || card.nomCarte || "-")}</div>

                <div>Édition</div>
                <div>${escapeHtml(card.referenceEdition || card.edition || "-")}</div>

                <div>Langue</div>
                <div>${escapeHtml(card.referenceLanguage || card.langue || "-")}</div>

                <div>Rôle</div>
                <div>${escapeHtml(referenceRole)}</div>

                <div>Référence trouvée</div>
                <div>${card.referenceCardFound ? "Oui" : "Non"}</div>
            </div>
        `;
    }

    if (weightsContainer) {
        weightsContainer.innerHTML =
            renderBayesianWeights(card.bayesianWeights);
    }

    if (observationsContainer) {
        observationsContainer.innerHTML =
            renderObservationTable(card);
    }

    if (ratiosContainer) {
        ratiosContainer.innerHTML =
            renderRatioTable(card.ratioByCondition);
    }
}

function formatOptionalEuro(value) {
    if (
        value === null ||
        value === undefined ||
        Number.isNaN(Number(value))
    ) {
        return "-";
    }

    return formatEuro(value);
}

function formatReliability(value) {
    if (
        value === null ||
        value === undefined ||
        Number.isNaN(Number(value))
    ) {
        return "-";
    }

    return `${Math.round(Number(value) * 100)} %`;
}

function renderBayesianWeights(weights) {
    if (!weights || typeof weights !== "object") {
        return `<p class="muted">Pondérations indisponibles.</p>`;
    }

    const rows = [
        ["Carte", weights.card],
        ["Édition", weights.edition],
        ["Langue", weights.language],
        ["Global", weights.global]
    ];

    return rows.map(([label, value]) => {
        const percent = Math.round(Number(value || 0) * 100);

        return `
            <div class="drawer-weight-row">
                <div class="drawer-weight-header">
                    <span>${label}</span>
                    <strong>${percent} %</strong>
                </div>

                <div class="drawer-progress">
                    <div
                        class="drawer-progress-bar"
                        style="width:${Math.max(0, Math.min(percent, 100))}%"
                    ></div>
                </div>
            </div>
        `;
    }).join("");
}

function renderObservationTable(card) {
    const conditions = ["NM", "EX", "GD", "LP", "PL", "PO"];

    const raw =
        card.observedMinByCondition || {};

    const reliable =
        card.reliableObservedByCondition || {};

    const reliability =
        card.observationReliabilityByCondition || {};

    const rows = conditions.map(condition => `
        <tr>
            <td><strong>${condition}</strong></td>
            <td>${formatOptionalEuro(raw[condition])}</td>
            <td>${formatOptionalEuro(reliable[condition])}</td>
            <td>${formatReliability(reliability[condition])}</td>
        </tr>
    `).join("");

    return `
        <div class="drawer-observation-summary">
            <span>
                ${Number(card.observationDaysCount || 0)}
                jour(s)
            </span>

            <span>
                ${Number(card.observationRowsCount || 0)}
                observation(s)
            </span>

            <span>
                Fiabilité moyenne :
                ${formatReliability(card.averageObservationReliability)}
            </span>
        </div>

        <div class="drawer-table-wrapper">
            <table class="drawer-table">
                <thead>
                    <tr>
                        <th>État</th>
                        <th>Brut</th>
                        <th>Fiabilisé</th>
                        <th>Fiabilité</th>
                    </tr>
                </thead>
                <tbody>
                    ${rows}
                </tbody>
            </table>
        </div>
    `;
}

function renderRatioTable(ratios) {
    if (!ratios || typeof ratios !== "object") {
        return `<p class="muted">Ratios indisponibles.</p>`;
    }

    const conditions = ["NM", "EX", "GD", "LP", "PL", "PO"];

    return `
        <div class="drawer-grid">
            ${conditions.map(condition => `
                <div>${condition}</div>
                <div>
                    ${
                        ratios[condition] !== null &&
                        ratios[condition] !== undefined
                            ? `${(Number(ratios[condition]) * 100).toFixed(1)} %`
                            : "-"
                    }
                </div>
            `).join("")}
        </div>
    `;
}

async function renderInvestmentChart(cardId) {
    const ctx = document.getElementById("investmentChart");
    if (!ctx) return;

    if (investmentChart) {
        investmentChart.destroy();
    }

    try {
        const detail = await window.apiAdapter.getCardDetail(cardId);

        if (!detail) {
            investmentChart = null;
            return;
        }

        const card = detail.card || {};
        const history = Array.isArray(detail.history)
            ? detail.history
            : [];

        const estimatedHistory = Array.isArray(detail.estimatedHistory)
            ? detail.estimatedHistory
            : [];

        const condition =
            String(card.etat || "NM").toUpperCase();

        const historyByDate = new Map();

        history.forEach(row => {
            if (!row.date) return;

            historyByDate.set(row.date, {
                ...row
            });
        });

        estimatedHistory.forEach(row => {
            if (!row.date) return;

            const existing =
                historyByDate.get(row.date) || {};

            historyByDate.set(row.date, {
                ...existing,
                ...row
            });
        });

        const chartRows = [...historyByDate.values()]
            .filter(row =>
                row.date &&
                String(row.date).slice(0, 10) >= MODEL_START_DATE
            )
            .sort((a, b) =>
                String(a.date).localeCompare(String(b.date))
            );

        if (!chartRows.length) {
            investmentChart = null;
            return;
        }

        const getTrendPrice = row =>
            row.trendPrice ??
            null;

        const getAvg30Price = row =>
            row.avg30 ??
            null;

        const getEstimatedPrice = row =>
            row.estimatedConditionPrice ??
            row.estimatedPrice ??
            row.estimatedByCondition?.[condition] ??
            null;

        const currentBuyTarget =
            card.buyTargetByCondition?.[condition] ??
            card.buyTargetByCondition?.NM ??
            null;

        const currentReliableObservation =
            card.reliableObservedByCondition?.[condition] ??
            card.observedMinByCondition?.[condition] ??
            null;

        const datasets = [
            {
                label: "Prix modèle (€)",
                data: chartRows.map(row =>
                    getEstimatedPrice(row)
                ),
                tension: 0.3,
                spanGaps: true
            },
            {
                label: "Trend Cardmarket (€)",
                data: chartRows.map(row =>
                    getTrendPrice(row)
                ),
                tension: 0.3,
                spanGaps: true
            },
            {
                label: "Moyenne 30 jours (€)",
                data: chartRows.map(row =>
                    getAvg30Price(row)
                ),
                tension: 0.3,
                spanGaps: true
            }
        ];

        if (
            currentBuyTarget !== null &&
            currentBuyTarget !== undefined
        ) {
            datasets.push({
                label: `Achat cible ${condition} (€)`,
                data: chartRows.map(() =>
                    Number(currentBuyTarget)
                ),
                tension: 0,
                pointRadius: 0,
                borderDash: [8, 6],
                spanGaps: true
            });
        }

        if (
            currentReliableObservation !== null &&
            currentReliableObservation !== undefined
        ) {
            datasets.push({
                label: `Observation fiabilisée ${condition} (€)`,
                data: chartRows.map(() =>
                    Number(currentReliableObservation)
                ),
                tension: 0,
                pointRadius: 0,
                borderDash: [3, 5],
                spanGaps: true
            });
        }

        investmentChart = new Chart(ctx, {
            type: "line",

            data: {
                labels: chartRows.map(row => row.date),
                datasets
            },

            options: {
                responsive: true,
                maintainAspectRatio: false,

                interaction: {
                    mode: "index",
                    intersect: false
                },

                plugins: {
                    legend: {
                        labels: {
                            color: "#f5f5f5",
                            usePointStyle: true,
                            boxWidth: 10
                        }
                    },

                    tooltip: {
                        callbacks: {
                            label(context) {
                                const value = context.parsed.y;

                                if (
                                    value === null ||
                                    value === undefined
                                ) {
                                    return `${context.dataset.label}: -`;
                                }

                                return `${context.dataset.label}: ${formatEuro(value)}`;
                            }
                        }
                    }
                },

                scales: {
                    x: {
                        ticks: {
                            color: "#f5f5f5",
                            maxRotation: 45,
                            minRotation: 0
                        },

                        grid: {
                            color: "rgba(255,255,255,0.1)"
                        }
                    },

                    y: {
                        beginAtZero: false,

                        ticks: {
                            color: "#f5f5f5",

                            callback(value) {
                                return formatEuro(value);
                            }
                        },

                        grid: {
                            color: "rgba(255,255,255,0.1)"
                        }
                    }
                }
            }
        });

    } catch (error) {
        console.error("Erreur graphique investissement :", error);
        investmentChart = null;
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

function updateInvestmentHeaderState() {
    document
        .querySelectorAll("#tab-investment-analysis .sortable")
        .forEach(header => {
            header.classList.remove("active-sort", "sort-asc", "sort-desc");

            if (header.dataset.sort === currentInvestmentSort) {
                header.classList.add("active-sort");
                header.classList.add(
                    currentInvestmentDirection === "asc" ? "sort-asc" : "sort-desc"
                );
            }
        });
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



function getOpportunitySortValue(card, sortKey) {
    const marketNM = Number(
        card.nmPrice ??
        card.trendPriceNM ??
        card.trendPrice ??
        0
    );

    const marketEX = Number(
        card.exPrice ??
        card.trendPriceEX ??
        card.prixEtat ??
        0
    );

    const targetNM = Number(
        card.nmTargetPrice ??
        card.buyTargetByCondition?.NM ??
        0
    );

    const targetEX = Number(
        card.exTargetPrice ??
        card.buyTargetByCondition?.EX ??
        0
    );

    switch (sortKey) {
        case "nomCarte":
            return card.nomCarte || "";

        case "edition":
            return card.edition || "";

        case "langue":
            return card.langue || "";

        case "ownedLabel":
            return card.owned ? 1 : 0;

        case "nmPrice":
            return marketNM;

        case "nmTargetPrice":
            return targetNM;

        case "discountNM":
            return calculateDiscountPercent(
                marketNM,
                targetNM
            );

        case "exPrice":
            return marketEX;

        case "exTargetPrice":
            return targetEX;

        case "discountEX":
            return calculateDiscountPercent(
                marketEX,
                targetEX
            );

        case "gradeModelConfidence":
            return Number(
                card.gradeModelConfidence ??
                card.pricingConfidence ??
                card.confidence ??
                0
            );
        
        case "opportunityScore":
    return calculateOpportunityScore(card);

        case "buyProbability":
            return Number(card.buyProbability || 0);

        default:
            return card[sortKey] ?? null;
    }
}

function clamp(value, min = 0, max = 100) {
    return Math.max(min, Math.min(max, Number(value) || 0));
}

function optionalPositiveNumber(...values) {
    for (const value of values) {
        if (
            value !== null &&
            value !== undefined &&
            value !== "" &&
            Number.isFinite(Number(value)) &&
            Number(value) > 0
        ) {
            return Number(value);
        }
    }

    return null;
}

function getOpportunityMetrics(card) {
    const marketNM = optionalPositiveNumber(
        card.nmPrice,
        card.trendPriceNM,
        card.trendPrice
    );

    const marketEX = optionalPositiveNumber(
        card.exPrice,
        card.observedExPrice,
        card.reliableObservedByCondition?.EX
    );

    const targetNM = optionalPositiveNumber(
        card.nmTargetPrice,
        card.buyTargetByCondition?.NM
    );

    const targetEX = optionalPositiveNumber(
        card.exTargetPrice,
        card.buyTargetByCondition?.EX
    );

    const discountNM = calculateDiscountPercent(
        marketNM,
        targetNM
    );

    const discountEX = calculateDiscountPercent(
        marketEX,
        targetEX
    );

    const confidence = optionalPositiveNumber(
        card.gradeModelConfidence,
        card.pricingConfidence,
        card.confidence
    ) ?? 0;

    const observationReliability = Number(
        card.averageObservationReliability ??
        card.observationReliability ??
        0
    );

    const reliabilityPercent =
        observationReliability <= 1
            ? observationReliability * 100
            : observationReliability;

    const momentum = Number(card.momentumQuality ?? 0);

    return {
        marketNM,
        marketEX,
        targetNM,
        targetEX,
        discountNM,
        discountEX,
        confidence,
        reliabilityPercent,
        momentum
    };
}
function discountToScore(discount) {
    if (discount === null || discount === undefined) {
        return 0;
    }

    /*
     * 0 % sous la cible = 40 points
     * 10 % sous la cible = 70 points
     * 20 % sous la cible = 100 points
     * Au-dessus de la cible, le score diminue.
     */
    return clamp(40 + Number(discount) * 3);
}

function calculateOpportunityScore(card) {
    const metrics = getOpportunityMetrics(card);

    const availableDiscounts = [
        metrics.discountNM,
        metrics.discountEX
    ].filter(value =>
        value !== null &&
        value !== undefined &&
        Number.isFinite(Number(value))
    );

    const bestDiscount =
        availableDiscounts.length > 0
            ? Math.max(...availableDiscounts)
            : null;

    const factors = [];

    if (bestDiscount !== null) {
        factors.push({
            value: discountToScore(bestDiscount),
            weight: 0.55
        });
    }

    if (metrics.confidence > 0) {
        factors.push({
            value: clamp(metrics.confidence),
            weight: 0.20
        });
    }

    if (metrics.reliabilityPercent > 0) {
        factors.push({
            value: clamp(metrics.reliabilityPercent),
            weight: 0.15
        });
    }

    if (metrics.momentum > 0) {
        factors.push({
            value: clamp(metrics.momentum),
            weight: 0.10
        });
    }

    const totalWeight = factors.reduce(
        (sum, factor) => sum + factor.weight,
        0
    );

    if (!totalWeight) {
        return 0;
    }

    const weightedScore = factors.reduce(
        (sum, factor) =>
            sum + factor.value * factor.weight,
        0
    );

    return Math.round(
        clamp(weightedScore / totalWeight)
    );
}

function getBestOpportunityCondition(card) {
    const metrics = getOpportunityMetrics(card);

    const discountNM =
        metrics.discountNM !== null &&
        metrics.discountNM !== undefined
            ? Number(metrics.discountNM)
            : null;

    const discountEX =
        metrics.discountEX !== null &&
        metrics.discountEX !== undefined
            ? Number(metrics.discountEX)
            : null;

    if (discountNM === null && discountEX === null) {
        return null;
    }

    if (discountEX === null) {
        return {
            condition: "NM",
            discount: discountNM
        };
    }

    if (discountNM === null) {
        return {
            condition: "EX",
            discount: discountEX
        };
    }

    return discountNM >= discountEX
        ? {
            condition: "NM",
            discount: discountNM
        }
        : {
            condition: "EX",
            discount: discountEX
        };
}

function getBuyingAction(card) {
    const score = calculateOpportunityScore(card);
    const bestOpportunity =
        getBestOpportunityCondition(card);

    if (!bestOpportunity) {
        return "⚪ Attendre";
    }

    const condition =
        bestOpportunity.condition;

    const discount =
        bestOpportunity.discount;

    if (score >= 80 && discount >= 15) {
        return `⭐ Forte opportunité ${condition}`;
    }

    if (score >= 68 && discount >= 8) {
        return `🟢 Acheter en ${condition}`;
    }

    if (score >= 55 && discount > 0) {
        return `🟡 Surveiller en ${condition}`;
    }

    return "⚪ Attendre";
}

function getBuyingActionClass(card) {
    const action = getBuyingAction(card);

    if (action.includes("Forte opportunité")) {
        return "decision-buy";
    }

    if (action.includes("Acheter")) {
        return "decision-buy";
    }

    if (action.includes("Surveiller")) {
        return "decision-watch";
    }

    return "decision-neutral";
}

function renderOpportunities() {
    const tbody = document.getElementById("opportunities-body");
    if (!tbody) return;

    const sorted = [...allOpportunities].sort((a, b) => {
    return compareValues(
        getOpportunitySortValue(a, currentOpportunitySort),
        getOpportunitySortValue(b, currentOpportunitySort),
        currentOpportunityDirection
    );
});

    tbody.innerHTML = "";

    sorted.forEach(card => {

    const metrics = getOpportunityMetrics(card);

const {
    marketNM,
    marketEX,
    targetNM,
    targetEX,
    discountNM,
    discountEX
} = metrics;

const confidence = metrics.confidence;
const opportunityScore =
    calculateOpportunityScore(card);

    const bestOpportunity =
    getBestOpportunityCondition(card);

    const scryfallUrl =
    card.scryfallUri ||
    (
        card.scryfallId
            ? `https://scryfall.com/card/${card.scryfallId}`
            : null
    );


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

        <td>${formatOptionalEuro(marketNM)}</td>

<td>${formatOptionalEuro(targetNM)}</td>

<td>${formatDiscount(discountNM)}</td>

<td>${formatOptionalEuro(marketEX)}</td>

<td>${formatOptionalEuro(targetEX)}</td>

<td>${formatDiscount(discountEX)}</td>

<td>
    ${confidence !== null
        ? `${Number(confidence).toFixed(0)} %`
        : "-"
    }
</td>

       

       <td>
    <span
        class="${getBuyingActionClass(card)}"
        title="Score d'opportunité : ${opportunityScore} / 100"
    >
        ${getBuyingAction(card)}
    </span>

    <div class="opportunity-subline">
    Score ${opportunityScore} / 100
    ${
        bestOpportunity
            ? ` · Meilleure marge ${bestOpportunity.condition} :
               ${bestOpportunity.discount >= 0 ? "+" : ""}
               ${bestOpportunity.discount.toFixed(1)} %`
            : ""
    }
</div>
</td>

<td class="links">
    ${
        scryfallUrl
            ? `
                <a
                    href="${escapeHtml(scryfallUrl)}"
                    target="_blank"
                    rel="noopener noreferrer"
                    onclick="event.stopPropagation()"
                >
                    Scryfall
                </a>
            `
            : "-"
    }
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
            <p><strong>Estimation état :</strong> ${formatEuro(getEstimatedConditionPrice(card))}</p>
<p><strong>Confiance :</strong> ${card.gradeModelConfidence ?? "-"} %</p>
<p><strong>Source modèle :</strong> ${escapeHtml(card.gradeModelSource || "-")}</p>
<p><strong>Jours observés :</strong> ${card.observationDaysCount ?? "-"}</p>
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

        const historyByDate = new Map();

history.forEach(row => {
    if (!row.date) return;
    historyByDate.set(row.date, { ...row });
});

estimatedHistory.forEach(row => {
    if (!row.date) return;

    const existing = historyByDate.get(row.date) || {};

    historyByDate.set(row.date, {
        ...existing,
        ...row
    });
});

const chartHistoryWithCondition = [...historyByDate.values()]
    .map(row => ({
        ...row,
        etat: card.etat,
        estimatedByCondition: card.estimatedByCondition
    }))
    .sort((a, b) => String(a.date).localeCompare(String(b.date)));

    console.log("history", history);
console.log("estimatedHistory", estimatedHistory);
console.log("chartHistoryWithCondition", chartHistoryWithCondition);
console.table(chartHistoryWithCondition);

window.debugChartHistory = chartHistoryWithCondition;

renderCardDetailChart(chartHistoryWithCondition);

        
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
        cardDetailChart = null;
        return;
    }

    history = history
        .filter(row =>
            row.date &&
            String(row.date).slice(0, 10) >= MODEL_START_DATE
        )
        .sort((a, b) =>
            String(a.date).localeCompare(String(b.date))
        );

    if (history.length === 0) {
        cardDetailChart = null;
        return;
    }

    const getMarketStatePrice = row =>
        row.prixEtat ??
        row.trendPrice ??
        row.avg30 ??
        null;

    const getEstimatedStatePrice = row =>
        row.estimatedConditionPrice ??
        row.estimatedPrice ??
        getEstimatedConditionPrice(row) ??
        null;

    const latestRow = history[history.length - 1];
    const latestEstimated = getEstimatedStatePrice(latestRow);
    const latestMarket = getMarketStatePrice(latestRow);

    const modelRatio =
        latestEstimated && latestMarket
            ? latestEstimated / latestMarket
            : 1;

    const hasMarketHistory = history.some(row =>
        getMarketStatePrice(row) !== null &&
        getMarketStatePrice(row) !== undefined
    );

    const datasets = [
        {
            label: "Estimation état (€)",
            data: history.map(row => {
                const market = getMarketStatePrice(row);

                if (market) {
                    return Number((market * modelRatio).toFixed(2));
                }

                return getEstimatedStatePrice(row);
            }),
            tension: 0.3
        }
    ];

    if (hasMarketHistory) {
        datasets.push({
            label: "Trend marché état (€)",
            data: history.map(row => getMarketStatePrice(row)),
            tension: 0.3
        });
    }

    cardDetailChart = new Chart(ctx, {
        type: "line",
        data: {
            labels: history.map(row => row.date),
            datasets
        },
        options: {
            responsive: true,
            plugins: {
                legend: {
                    labels: {
                        color: "#f5f5f5"
                    }
                }
            },
            scales: {
                x: {
                    ticks: {
                        color: "#f5f5f5"
                    },
                    grid: {
                        color: "rgba(255,255,255,0.1)"
                    }
                },
                y: {
                    ticks: {
                        color: "#f5f5f5"
                    },
                    grid: {
                        color: "rgba(255,255,255,0.1)"
                    }
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
function calculateDiscountPercent(marketPrice, targetPrice) {

    const market = Number(marketPrice);
    const target = Number(targetPrice);

    if (
        !Number.isFinite(market) ||
        !Number.isFinite(target) ||
        target <= 0
    ) {
        return null;
    }

    return ((target - market) / target) * 100;
}

function formatDiscount(value) {
    if (value === null || value === undefined) {
        return `<span class="muted">-</span>`;
    }

    const cssClass =
        value >= 10
            ? "score-positive"
            : value > 0
                ? "signal-watch"
                : "score-negative";

    return `
        <span class="${cssClass}">
            ${value >= 0 ? "+" : ""}${Number(value).toFixed(1)} %
        </span>
    `;
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