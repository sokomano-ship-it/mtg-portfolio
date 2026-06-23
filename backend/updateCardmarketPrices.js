const axios = require("axios");
const cheerio = require("cheerio");
const db = require("./database");

function getCards() {
    return new Promise((resolve, reject) => {
        db.all(
            "SELECT * FROM cards WHERE cardmarketId IS NOT NULL ORDER BY id",
            [],
            (err, rows) => err ? reject(err) : resolve(rows)
        );
    });
}

function savePrice(cardId, trendPrice, lowPrice, avgPrice, availableArticles, sourceUrl) {
    return new Promise((resolve, reject) => {
        const today = new Date().toISOString().slice(0, 10);

        db.run(
            `
            INSERT INTO cardmarket_prices (
                cardId,
                date,
                trendPrice,
                lowPrice,
                avgPrice,
                availableArticles,
                sourceUrl
            )
            VALUES (?, ?, ?, ?, ?, ?, ?)
            `,
            [
                cardId,
                today,
                trendPrice,
                lowPrice,
                avgPrice,
                availableArticles,
                sourceUrl
            ],
            err => err ? reject(err) : resolve()
        );
    });
}

function parseEuro(text) {
    if (!text) return null;

    const match = text
        .replace(/\s/g, "")
        .replace(",", ".")
        .match(/(\d+(\.\d+)?)/);

    return match ? Number(match[1]) : null;
}

function findPriceByLabel($, label) {
    let result = null;

    $("*").each((_, el) => {
        const text = $(el).text().trim();

        if (
            text.toLowerCase().includes(label.toLowerCase()) &&
            text.includes("€")
        ) {
            result = parseEuro(text);
            return false;
        }
    });

    return result;
}

async function fetchCardmarketPrice(card) {
    const url =
        `https://www.cardmarket.com/fr/Magic/Products/Singles?idProduct=${card.cardmarketId}`;

    const response = await axios.get(url, {
        headers: {
            "User-Agent":
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36",
            "Accept-Language": "fr-FR,fr;q=0.9,en;q=0.8"
        },
        timeout: 15000
    });

    const $ = cheerio.load(response.data);

    const pageText = $.text();

    const trendPrice =
        findPriceByLabel($, "Prix tendance") ||
        findPriceByLabel($, "Trend") ||
        null;

    const lowPrice =
        findPriceByLabel($, "À partir de") ||
        findPriceByLabel($, "From") ||
        null;

    const avgPrice =
        findPriceByLabel($, "Prix moyen") ||
        findPriceByLabel($, "Average") ||
        null;

    const availableMatch =
        pageText.match(/(\d+)\s+(articles|offres|offers)/i);

    const availableArticles =
        availableMatch ? Number(availableMatch[1]) : null;

    await savePrice(
        card.id,
        trendPrice,
        lowPrice,
        avgPrice,
        availableArticles,
        url
    );

    console.log(
        `✅ ${card.nomCarte} | Trend: ${trendPrice ?? "-"}€ | Low: ${lowPrice ?? "-"}€ | Articles: ${availableArticles ?? "-"}`
    );
}

async function main() {
    const cards = await getCards();

    console.log(`${cards.length} cartes à tester sur Cardmarket...`);

    for (const card of cards) {
        try {
            await fetchCardmarketPrice(card);

            await new Promise(resolve => setTimeout(resolve, 2000));
        } catch (error) {
            console.log(
                `❌ ${card.nomCarte} : ${error.response?.status || ""} ${error.message}`
            );
        }
    }

    console.log("Mise à jour Cardmarket terminée.");
    db.close();
}

main();