const axios = require("axios");
const db = require("./database");

const PRICE_GUIDE_URL =
    "https://downloads.s3.cardmarket.com/productCatalog/priceGuide/price_guide_1.json";

function normalize(value) {
    return String(value || "")
        .toLowerCase()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/\(v\.\d+\)/gi, "")
        .replace(/[^a-z0-9]/g, "")
        .trim();
}

function cleanCardName(name) {
    return String(name || "")
        .replace(/\((V\.\d+)\)/i, "")
        .trim();
}

function editionAliases(edition) {
    const value = String(edition || "").trim();

    const aliases = {
        "Arabian Nights": [
            "Arabian Nights"
        ],

        "Antiquities": [
            "Antiquities"
        ],

        "Legends": [
            "Legends",
            "Legend"
        ],

        "Legend": [
            "Legends",
            "Legend"
        ],

        "Legends Italian": [
            "Legends",
            "Legend",
            "Legends Italian",
            "Rinascimento"
        ],

        "The Dark": [
            "The Dark"
        ],

        "Fallen Empires": [
            "Fallen Empires"
        ],

        "Chronicles": [
            "Chronicles"
        ],

        "Renaissance": [
            "Renaissance"
        ],

        "Fourth Edition": [
            "Fourth Edition",
            "4th Edition"
        ],

        "4th Edition": [
            "Fourth Edition",
            "4th Edition"
        ],

        "Unlimited": [
            "Unlimited",
            "Unlimited Edition"
        ],

        "Unlimited Edition": [
            "Unlimited",
            "Unlimited Edition"
        ],

        "Revised": [
            "Revised",
            "Revised Edition",
            "3rd Edition",
            "Third Edition"
        ],

        "Revised Edition": [
            "Revised",
            "Revised Edition",
            "3rd Edition",
            "Third Edition"
        ],

        "Foreign White Bordered": [
            "Revised",
            "Revised Edition",
            "3rd Edition",
            "Third Edition",
            "Foreign White Bordered",
            "Foreign White Border"
        ],

        "Foreign White Border": [
            "Revised",
            "Revised Edition",
            "3rd Edition",
            "Third Edition",
            "Foreign White Bordered",
            "Foreign White Border"
        ],

        "FWB": [
            "Revised",
            "Revised Edition",
            "3rd Edition",
            "Third Edition",
            "Foreign White Bordered",
            "Foreign White Border"
        ],

        "Foreign Black Bordered": [
            "Foreign Black Bordered",
            "Foreign Black Border"
        ],

        "Foreign Black Border": [
            "Foreign Black Bordered",
            "Foreign Black Border"
        ],

        "FBB": [
            "Foreign Black Bordered",
            "Foreign Black Border"
        ]
    };

    return aliases[value] || [value];
}

function isForeignWhiteBordered(edition) {
    const value = normalize(edition);

    return (
        value === "foreignwhitebordered" ||
        value === "foreignwhiteborder" ||
        value === "fwb"
    );
}

function isLegendsItalian(card) {
    const edition = normalize(card.edition);
    const langue = normalize(card.langue);

    return (
        edition === "legendsitalian" ||
        (edition === "legends" && langue === "italian")
    );
}

function getPriceName(price) {
    return (
        price.enName ||
        price.name ||
        price.productName ||
        price.nameProduct ||
        price.locName ||
        ""
    );
}

function getExpansionName(price) {
    return (
        price.expansionName ||
        price.expansion ||
        price.categoryName ||
        price.nameExpansion ||
        ""
    );
}

function getProductId(price) {
    return Number(
        price.idProduct ||
        price.productId ||
        price.id ||
        0
    );
}

function getPriceValue(price, key) {
    if (price[key] !== undefined) {
        return price[key];
    }

    if (price.priceGuide && price.priceGuide[key] !== undefined) {
        return price.priceGuide[key];
    }

    const upperKey = key.toUpperCase();

    if (price.priceGuide && price.priceGuide[upperKey] !== undefined) {
        return price.priceGuide[upperKey];
    }

    return null;
}

function extractPrice(price) {
    return {
        trend: getPriceValue(price, "trend") ?? getPriceValue(price, "TREND"),
        low: getPriceValue(price, "low") ?? getPriceValue(price, "LOW"),
        avg: getPriceValue(price, "avg") ?? getPriceValue(price, "AVG"),
        avg1: getPriceValue(price, "avg1") ?? getPriceValue(price, "AVG1"),
        avg7: getPriceValue(price, "avg7") ?? getPriceValue(price, "AVG7"),
        avg30: getPriceValue(price, "avg30") ?? getPriceValue(price, "AVG30")
    };
}

function getCards() {
    return new Promise((resolve, reject) => {
        db.all(
            `
            SELECT *
            FROM cards
            ORDER BY id
            `,
            [],
            (err, rows) => err ? reject(err) : resolve(rows)
        );
    });
}

function updateCardmarketId(cardId, cardmarketId) {
    return new Promise((resolve, reject) => {
        db.run(
            `
            UPDATE cards
            SET cardmarketId = ?
            WHERE id = ?
            `,
            [cardmarketId, cardId],
            err => err ? reject(err) : resolve()
        );
    });
}

function saveCardmarketPrice(cardId, rawPrice, sourceUrl) {
    return new Promise((resolve, reject) => {
        const today = new Date().toISOString().slice(0, 10);
        const price = extractPrice(rawPrice);

        db.serialize(() => {
            db.run(
                `
                DELETE FROM cardmarket_prices
                WHERE cardId = ?
                  AND date = ?
                `,
                [cardId, today],
                err => {
                    if (err) {
                        reject(err);
                        return;
                    }

                    db.run(
                        `
                        INSERT INTO cardmarket_prices (
                            cardId,
                            date,
                            trendPrice,
                            lowPrice,
                            avgPrice,
                            avg1,
                            avg7,
                            avg30,
                            sourceUrl
                        )
                        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                        `,
                        [
                            cardId,
                            today,
                            price.trend,
                            price.low,
                            price.avg,
                            price.avg1,
                            price.avg7,
                            price.avg30,
                            sourceUrl
                        ],
                        insertErr => insertErr ? reject(insertErr) : resolve()
                    );
                }
            );
        });
    });
}

function buildIndexes(priceGuides) {
    const byProductId = new Map();
    const byName = new Map();

    priceGuides.forEach(price => {
        const idProduct = getProductId(price);
        const name = normalize(getPriceName(price));

        if (idProduct) {
            byProductId.set(idProduct, price);
        }

        if (!byName.has(name)) {
            byName.set(name, []);
        }

        byName.get(name).push(price);
    });

    return {
        byProductId,
        byName,
        all: priceGuides
    };
}

function findCandidatesByName(card, indexes) {
    const names = [
        card.nomBase,
        card.nomCarte,
        cleanCardName(card.nomCarte)
    ]
        .filter(Boolean)
        .map(normalize);

    const uniqueNames = [...new Set(names)];

    let candidates = [];

    uniqueNames.forEach(name => {
        const exact = indexes.byName.get(name) || [];
        candidates = candidates.concat(exact);
    });

    if (candidates.length > 0) {
        return candidates;
    }

    const mainName = normalize(cleanCardName(card.nomBase || card.nomCarte));

    return indexes.all.filter(price => {
        const priceName = normalize(getPriceName(price));

        return (
            priceName === mainName ||
            priceName.includes(mainName) ||
            mainName.includes(priceName)
        );
    });
}

function findEditionMatch(card, candidates) {
    const acceptedEditions =
        editionAliases(card.edition)
            .map(normalize);

    const exactEditionMatch =
        candidates.find(price =>
            acceptedEditions.includes(
                normalize(getExpansionName(price))
            )
        );

    if (exactEditionMatch) {
        return exactEditionMatch;
    }

    if (isForeignWhiteBordered(card.edition)) {
        const revisedFallback =
            candidates.find(price => {
                const expansion = normalize(getExpansionName(price));

                return (
                    expansion.includes("revised") ||
                    expansion.includes("3rdedition") ||
                    expansion.includes("thirdedition")
                );
            });

        if (revisedFallback) {
            return revisedFallback;
        }
    }

    if (isLegendsItalian(card)) {
        const legendsFallback =
            candidates.find(price => {
                const expansion = normalize(getExpansionName(price));

                return (
                    expansion === "legends" ||
                    expansion === "legend"
                );
            });

        if (legendsFallback) {
            return legendsFallback;
        }
    }

    return null;
}

function findPriceForCard(card, indexes) {
    if (card.cardmarketId) {
        const price = indexes.byProductId.get(Number(card.cardmarketId));

        if (price) {
            return price;
        }
    }

    const candidates = findCandidatesByName(card, indexes);

    if (candidates.length === 0) {
        return null;
    }

    const editionMatch = findEditionMatch(card, candidates);

    if (editionMatch) {
        return editionMatch;
    }

    return null;
}

async function main() {
    console.log("Téléchargement du Price Guide Cardmarket...");

    const response = await axios.get(PRICE_GUIDE_URL, {
        timeout: 60000,
        responseType: "json"
    });

    const priceGuides = response.data.priceGuides || [];

    console.log(`${priceGuides.length} prix chargés.`);

    const indexes = buildIndexes(priceGuides);
    const cards = await getCards();

    console.log(`${cards.length} cartes de ta collection à valoriser.`);

    let found = 0;
    let missing = 0;

    for (const card of cards) {
        const price = findPriceForCard(card, indexes);

        if (!price) {
            console.log(
                `❌ Prix introuvable : ${card.nomCarte} | ${card.edition}`
            );
            missing++;
            continue;
        }

        const idProduct = getProductId(price);
        const extracted = extractPrice(price);

        if (idProduct && Number(card.cardmarketId) !== idProduct) {
            await updateCardmarketId(card.id, idProduct);
        }

        await saveCardmarketPrice(
            card.id,
            price,
            PRICE_GUIDE_URL
        );

        found++;

        console.log(
            `✅ ${card.nomCarte} | ${card.edition} -> ${getExpansionName(price)} | Cardmarket ${idProduct || "-"} | Trend ${extracted.trend ?? "-"}€ | Avg1 ${extracted.avg1 ?? "-"}€ | Avg7 ${extracted.avg7 ?? "-"}€ | Avg30 ${extracted.avg30 ?? "-"}€`
        );
    }

    console.log("Import Cardmarket terminé.");
    console.log(`Trouvés : ${found}`);
    console.log(`Manquants : ${missing}`);

    db.close();
}

main().catch(error => {
    console.error("Erreur :", error.message);
    db.close();
});