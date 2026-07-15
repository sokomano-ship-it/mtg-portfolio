const axios = require("axios");
const db = require("./database");

const EDITION_TO_SCRYFALL_SET = {
    "Arabian Nights": "arn",
    "Antiquities": "atq",
    "Legends": "leg",
    "Legends Italian": "leg",
    "The Dark": "drk",

    "Fallen Empire": "fem",
    "Fallen Empires": "fem",

    "Unlimited": "2ed",
    "Unlimited Edition": "2ed",

    "Revised": "3ed",
    "Revised Edition": "3ed",

    "Fourth Edition": "4ed",
    "4th Edition": "4ed",

    "Fifth Edition": "5ed",
    "5th Edition": "5ed",

    "Sixth Edition": "6ed",
    "6th Edition": "6ed",
    "Classic Sixth Edition": "6ed",

    "Chronicles": "chr",
    "Renaissance": "ren",

    "Ice Age": "ice",
    "Homelands": "hml",
    "Alliances": "all",

    "Mirage": "mir",
    "Visions": "vis",
    "Weatherlight": "wth",

    "Tempest": "tmp",
    "Stronghold": "sth",
    "Exodus": "exo",

    "Urza's Saga": "usg",
    "Urzas Saga": "usg",

    "Urza's Legacy": "ulg",
    "Urzas Legacy": "ulg",

    "Urza's Destiny": "uds",
    "Urzas Destiny": "uds",

    "Unglued": "ugl",

    "Foreign White Bordered": "3ed",
    "Foreign White Border": "3ed",
    "FWB": "3ed",

    "Foreign Black Bordered": "fbb",
    "Foreign Black Border": "fbb",
    "FBB": "fbb"
};

const LANGUAGE_TO_SCRYFALL_LANG = {
    "English": "en",
    "French": "fr",
    "German": "de",
    "Italian": "it",
    "Spanish": "es",
    "Portuguese": "pt",
    "Japanese": "ja"
};

const HYMN_COLLECTOR_BY_VERSION = {
    "V.1": "38a",
    "V.2": "38b",
    "V.3": "38c",
    "V.4": "38d"
};

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function normalize(value) {
    return String(value || "").trim();
}

function cleanCardName(name) {
    return normalize(name)
        .replace(/\((V\.\d+)\)/i, "")
        .trim();
}

function getSetCode(edition) {
    return EDITION_TO_SCRYFALL_SET[normalize(edition)] || null;
}

function getLangCode(language) {
    return LANGUAGE_TO_SCRYFALL_LANG[normalize(language)] || null;
}

function isFWB(edition) {
    const value = normalize(edition).toLowerCase();

    return (
        value === "foreign white bordered" ||
        value === "foreign white border" ||
        value === "fwb"
    );
}

function isLegendsItalian(card) {
    const edition = normalize(card.edition).toLowerCase();
    const langue = normalize(card.langue).toLowerCase();

    return (
        edition === "legends italian" ||
        (edition === "legends" && langue === "italian")
    );
}

function isHymnToTourach(card) {
    return cleanCardName(card.nomBase || card.nomCarte).toLowerCase() === "hymn to tourach";
}

function isUngluedGoblinToken(card) {
    const cardName = cleanCardName(
        card.nomBase || card.nomCarte
    ).toLowerCase();

    const edition = normalize(
        card.edition
    ).toLowerCase();

    return (
        cardName === "goblin" &&
        edition === "unglued"
    );
}

function getHymnCollectorNumber(card) {
    return HYMN_COLLECTOR_BY_VERSION[normalize(card.version)] || null;
}

function getCardsToEnrich() {
    return new Promise((resolve, reject) => {
        db.all(
            `
            SELECT
                id,
                nomCarte,
                nomBase,
                version,
                edition,
                langue
            FROM cards
            `,
            [],
            (err, rows) => {
                if (err) reject(err);
                else resolve(rows);
            }
        );
    });
}

async function callScryfall(url, label, attempt = 1) {
    try {
        await sleep(350);

        return await axios.get(url, {
            headers: {
                "User-Agent": "mtg-portfolio/1.0",
                "Accept": "application/json"
            }
        });
    } catch (error) {
        if (error.response?.status === 429 && attempt <= 6) {
            const wait = 2500 * attempt;

            console.log(
                `⏳ Rate limit Scryfall pour ${label}. Pause ${wait / 1000}s...`
            );

            await sleep(wait);

            return callScryfall(url, label, attempt + 1);
        }

        throw error;
    }
}

async function getExactScryfallBySetAndCollector(setCode, collectorNumber, langCode, label) {
    const url =
        `https://api.scryfall.com/cards/${encodeURIComponent(setCode)}/${encodeURIComponent(collectorNumber)}/${encodeURIComponent(langCode || "en")}`;

    try {
        const response = await callScryfall(url, label);
        return response.data;
    } catch (error) {
        if (error.response?.status === 404) {
            return null;
        }

        console.log(`⚠️ Scryfall exact erreur pour ${label} : ${error.message}`);

        return {
            rateLimitOrError: true
        };
    }
}

async function searchScryfall(card, options = {}) {
    const cardName = cleanCardName(
        card.nomBase || card.nomCarte
    );

    const setCode =
    options.forceSetCode ||
    (
        isUngluedGoblinToken(card)
            ? "tugl"
            : getSetCode(card.edition)
    );

    const langCode =
        options.forceLangCode ||
        getLangCode(card.langue);

    console.log(
        `🔎 ${cardName} | ${card.edition} | set:${setCode || "-"} | lang:${langCode || "-"}`
    );

    if (
        isHymnToTourach(card) &&
        setCode === "fem" &&
        getHymnCollectorNumber(card)
    ) {
        const exactHymn =
            await getExactScryfallBySetAndCollector(
                "fem",
                getHymnCollectorNumber(card),
                langCode || "en",
                cardName
            );

        if (
            exactHymn &&
            !exactHymn.rateLimitOrError
        ) {
            return exactHymn;
        }
    }

    /*
     * Lorsqu'une édition est connue, on ne lance jamais
     * de recherche sans ce set.
     */
    const queries = setCode
        ? [
            langCode
                ? `!"${cardName}" set:${setCode} lang:${langCode}`
                : null,
            `!"${cardName}" set:${setCode}`
        ].filter(Boolean)
        : [
            langCode
                ? `!"${cardName}" lang:${langCode}`
                : null,
            `!"${cardName}"`
        ].filter(Boolean);

    for (const query of queries) {
        const url =
            "https://api.scryfall.com/cards/search?q=" +
            encodeURIComponent(query) +
            "&unique=prints&order=set";

        try {
            const response =
                await callScryfall(url, cardName);

            const results =
                response.data?.data || [];

            const exactResults = results.filter(result => {
                if (
                    setCode &&
                    result.set !== setCode
                ) {
                    return false;
                }

                return true;
            });

            if (!exactResults.length) {
                continue;
            }

            /*
             * On préfère la langue demandée.
             * Si cette langue n'existe pas dans cette édition,
             * on conserve l'impression anglaise du bon set.
             */
            const match =
                exactResults.find(result =>
                    result.lang === langCode
                ) ||
                exactResults.find(result =>
                    result.lang === "en"
                ) ||
                exactResults[0];

            /*
             * Sécurité absolue :
             * une impression d'un autre set est refusée.
             */
            if (
                setCode &&
                match.set !== setCode
            ) {
                console.log(
                    `❌ Mauvais set refusé pour ${cardName} : ` +
                    `${match.set} au lieu de ${setCode}`
                );

                continue;
            }

            return match;

        } catch (error) {
            if (error.response?.status === 404) {
                continue;
            }

            console.log(
                `⚠️ Scryfall erreur pour ${cardName} : ${error.message}`
            );

            return {
                rateLimitOrError: true
            };
        }
    }

    return null;
}

async function getCardmarketIdForPricing(card, displayedScryfallCard) {
    /*
        Legends Italian :
        image = Legends italien
        prix = Legends anglais
        décote = appliquée dans conditionPricing.js
    */
    if (isLegendsItalian(card)) {
        const englishLegendsCard = await searchScryfall(card, {
            forceSetCode: "leg",
            forceLangCode: "en"
        });

        if (englishLegendsCard?.cardmarket_id) {
            return englishLegendsCard.cardmarket_id;
        }
    }

    /*
        FWB :
        image = FWB dans la langue réelle
        prix = Revised anglais
        ajustement = appliqué dans conditionPricing.js
    */
    if (isFWB(card.edition)) {
        const revisedEnglishCard = await searchScryfall(card, {
            forceSetCode: "3ed",
            forceLangCode: "en"
        });

        if (revisedEnglishCard?.cardmarket_id) {
            return revisedEnglishCard.cardmarket_id;
        }
    }

    /*
        Cas général :
        si la carte affichée est non anglaise et n'a pas de cardmarket_id,
        on prend le prix de la même édition en anglais.
        Exemple :
        Royal Assassin | Fourth Edition | French
        -> prix Royal Assassin | Fourth Edition | English
    */
    if (
        !displayedScryfallCard.cardmarket_id &&
        displayedScryfallCard.set
    ) {
        const englishSameSetCard = await searchScryfall(card, {
            forceSetCode: displayedScryfallCard.set,
            forceLangCode: "en"
        });

        if (englishSameSetCard?.cardmarket_id) {
            return englishSameSetCard.cardmarket_id;
        }
    }

    return displayedScryfallCard.cardmarket_id || null;
}

function updateCard(cardId, displayedScryfallCard, cardmarketId) {
    return new Promise((resolve, reject) => {
        const imageUrl =
            displayedScryfallCard.image_uris?.normal ||
            displayedScryfallCard.card_faces?.[0]?.image_uris?.normal ||
            null;

        db.run(
            `
            UPDATE cards
            SET
                scryfallId = ?,
                imageUrl = ?,
                priceUsd = ?,
                priceEur = ?,
                cardmarketId = ?
            WHERE id = ?
            `,
            [
                displayedScryfallCard.id,
                imageUrl,
                displayedScryfallCard.prices?.usd || null,
                displayedScryfallCard.prices?.eur || null,
                cardmarketId || null,
                cardId
            ],
            err => {
                if (err) reject(err);
                else resolve();
            }
        );
    });
}

async function main() {
    const cards = await getCardsToEnrich();

    console.log(`${cards.length} cartes à vérifier via Scryfall...`);

    let found = 0;
    let missing = 0;
    let skipped = 0;

    for (const card of cards) {
        const displayedScryfallCard = await searchScryfall(card);

        if (displayedScryfallCard?.rateLimitOrError) {
            console.log(
                `⏭️ Ignorée temporairement : ${card.nomCarte} | ${card.edition}`
            );
            skipped += 1;
            continue;
        }

        if (!displayedScryfallCard) {
            console.log(
                `❌ Non trouvée : ${card.nomCarte} | ${card.edition} | ${card.langue}`
            );
            missing += 1;
            continue;
        }

        const cardmarketId =
            await getCardmarketIdForPricing(card, displayedScryfallCard);

        await updateCard(card.id, displayedScryfallCard, cardmarketId);

        console.log(
            `✅ ${card.nomCarte} | ${card.edition} | ${card.version || "-"} | image:${displayedScryfallCard.set}/${displayedScryfallCard.collector_number}/${displayedScryfallCard.lang} | prix Cardmarket:${cardmarketId || "-"}`
        );

        found += 1;

        await sleep(700);
    }

    console.log("Enrichissement Scryfall terminé.");
    console.log(`Trouvées : ${found}`);
    console.log(`Manquantes : ${missing}`);
    console.log(`Ignorées temporairement : ${skipped}`);

    db.close();
}

main().catch(error => {
    console.error(error);
    db.close();
});