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


const FBB_LAND_IDS = {
    "Forest|V.1": 15461,
    "Forest|V.2": 15462,
    "Forest|V.3": 15463,
    "Island|V.1": 15464,
    "Island|V.2": 15465,
    "Island|V.3": 15466,
    "Mountain|V.1": 15467,
    "Mountain|V.2": 15468,
    "Mountain|V.3": 15469,
    "Plains|V.1": 15470,
    "Plains|V.2": 15471,
    "Plains|V.3": 15472,
    "Swamp|V.1": 15476,
    "Swamp|V.2": 15477,
    "Swamp|V.3": 15478
};

function getFbbLandReference(card) {
    if (
        String(card.edition || "").trim() !==
            "Foreign Black Bordered" ||
        String(card.langue || "").trim() !== "French"
    ) {
        return null;
    }

    const match = String(card.nomCarte || "")
        .trim()
        .match(
            /^(Forest|Island|Mountain|Plains|Swamp)(?:\s*\(V\.([123])\))?$/
        );

    if (!match) return null;

    const version = match[2]
        ? `V.${match[2]}`
        : String(card.version || "").trim();

    const key = `${match[1]}|${version}`;
    const id = FBB_LAND_IDS[key];

    if (!id) {
        throw new Error(
            `Version FBB non reconnue : ${card.nomCarte} / ${card.version}`
        );
    }

    return { key, id };
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

async function main() {
    console.log("Téléchargement du Price Guide Cardmarket...");

    const response = await axios.get(PRICE_GUIDE_URL, {
        timeout: 60000,
        responseType: "json"
    });

    const priceGuides = response.data.priceGuides || [];

    console.log(`${priceGuides.length} prix chargés.`);

    const indexes = buildIndexes(priceGuides);
    
const pricesByProductId = new Map();

for (const row of priceGuides) {
    const id = Number(getProductId(row));
    if (Number.isInteger(id) && id > 0) {
        if (pricesByProductId.has(id)) {
            throw new Error(`Identifiant Cardmarket dupliqué : ${id}`);
        }
        pricesByProductId.set(id, row);
    }
}

    const cards = await getCards();

    console.log(`${cards.length} cartes de ta collection à valoriser.`);

    let found = 0;
    let missing = 0;

    for (const card of cards) {
        
const fbbReference = getFbbLandReference(card);

const price = fbbReference
    ? pricesByProductId.get(fbbReference.id)
    : findPriceForCard(card, indexes);

if (fbbReference && !price) {
    throw new Error(
        `Prix Cardmarket absent : ${fbbReference.key} ` +
        `(ID ${fbbReference.id})`
    );
}


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