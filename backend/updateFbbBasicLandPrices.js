
const fs = require("fs");
const path = require("path");
const axios = require("axios");

const FILE = path.join(
    __dirname,
    "data",
    "trackedMarketCards.json"
);

const URL =
    "https://downloads.s3.cardmarket.com/productCatalog/priceGuide/price_guide_1.json";

const EXPECTED = new Map([
    ["Forest (V.1)", 5812],
["Forest (V.2)", 5813],
["Forest (V.3)", 5814],
    ["Island (V.1)", 5815],
    ["Island (V.2)", 5816],
    ["Island (V.3)", 5817],
    ["Mountain (V.1)", 5818],
    ["Mountain (V.2)", 5819],
    ["Mountain (V.3)", 5820],
    ["Plains (V.1)", 5821],
    ["Plains (V.2)", 5822],
    ["Plains (V.3)", 5823],
    ["Swamp (V.1)", 5827],
    ["Swamp (V.2)", 5828],
    ["Swamp (V.3)", 5829]
]);

const apply = process.argv.includes("--apply");

function positiveNumber(value) {
    if (value === null || value === undefined || value === "") {
        return null;
    }
    const n = Number(value);
    return Number.isFinite(n) && n > 0 ? n : null;
}

function optionalNumber(value) {
    if (value === null || value === undefined || value === "") {
        return null;
    }
    const n = Number(value);
    return Number.isFinite(n) && n >= 0 ? n : null;
}

async function main() {
    const original = fs.readFileSync(FILE, "utf8");
    const cards = JSON.parse(original);

    if (!Array.isArray(cards)) {
        throw new Error("Le fichier trackedMarketCards.json doit etre un tableau.");
    }

    const targets = cards.filter(card =>
        card.edition === "Revised" &&
        card.langue === "English" &&
        EXPECTED.has(card.nomCarte)
    );

    if (targets.length !== 15 ||
        new Set(targets.map(c => c.nomCarte)).size !== 15) {
        throw new Error(
            `References trouvees : ${targets.length}, attendu : 15 distinctes.`
        );
    }

    for (const card of targets) {
        const expectedId = EXPECTED.get(card.nomCarte);
        if (Number(card.cardmarketId) !== expectedId) {
            throw new Error(
                `${card.nomCarte}: ID ${card.cardmarketId}, attendu ${expectedId}`
            );
        }
    }

    console.log("Telechargement du guide Cardmarket EUR...");

    const response = await axios.get(URL, {
        timeout: 120000
    });

    const raw = response.data;
    const prices = Array.isArray(raw)
        ? raw
        : raw.priceGuides || raw.products || [];

    if (!Array.isArray(prices) || !prices.length) {
        throw new Error("Guide Cardmarket vide ou format inattendu.");
    }

    const byId = new Map(
        prices.map(p => [Number(p.idProduct), p])
    );

    const changes = [];

    const updated = cards.map(card => {
        if (
            card.edition !== "Revised" ||
            card.langue !== "English" ||
            !EXPECTED.has(card.nomCarte)
        ) {
            return card;
        }

        const id = EXPECTED.get(card.nomCarte);
        const market = byId.get(id);

        if (!market) {
            throw new Error(
                `Produit Cardmarket introuvable : ${card.nomCarte} (${id})`
            );
        }

        const trend = positiveNumber(market.trend);

        if (trend === null) {
            throw new Error(
                `Prix de tendance absent/invalide : ${card.nomCarte} (${id})`
            );
        }

        changes.push({
            name: card.nomCarte,
            id,
            oldTrend: card.trendPrice ?? null,
            newTrend: trend
        });

        return {
            ...card,
            trendPrice: trend,
            lowPrice: optionalNumber(market.low),
            avgPrice: optionalNumber(market.avg),
            avg1: optionalNumber(market.avg1),
            avg7: optionalNumber(market.avg7),
            avg30: optionalNumber(market.avg30),
            priceUpdatedAt: new Date().toISOString()
        };
    });

    if (changes.length !== 15) {
        throw new Error(
            `Mise a jour incomplete : ${changes.length}/15`
        );
    }

    console.table(changes);

    if (!apply) {
        console.log(
            "SIMULATION : aucun fichier modifie, aucune ecriture Turso."
        );
        return;
    }

    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const backup = `${FILE}.before-fbb-prices-${stamp}.bak`;
    const temporary = `${FILE}.tmp`;

    fs.writeFileSync(backup, original, {
        encoding: "utf8",
        flag: "wx"
    });

    try {
        fs.writeFileSync(
            temporary,
            JSON.stringify(updated, null, 2),
            "utf8"
        );
        fs.renameSync(temporary, FILE);
    } catch (error) {
        if (fs.existsSync(temporary)) {
            fs.unlinkSync(temporary);
        }
        throw error;
    }

    console.log("15 prix Cardmarket EUR mis a jour.");
    console.log("Sauvegarde :", backup);
    console.log("Aucune ecriture Turso.");
}

main().catch(error => {
    console.error("ERREUR :", error.message);
    process.exitCode = 1;
});
