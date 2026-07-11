const axios = require("axios");
const db = require("./database");
const {
    buildIndexes,
    findPriceForCard,
    extractPrice,
    getProductId,
    getExpansionName
} = require("./pricingEngine/cardmarketLookup");

const PRICE_GUIDE_URL =
    "https://downloads.s3.cardmarket.com/productCatalog/priceGuide/price_guide_1.json";



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