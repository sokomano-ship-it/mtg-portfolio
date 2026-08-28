const fs = require("fs");
const path = require("path");
const https = require("https");
const zlib = require("zlib");
const { parser } = require("stream-json");
const { pick } = require("stream-json/filters/pick.js");
const { streamObject } = require("stream-json/streamers/stream-object.js");

const ROOT = path.join(__dirname, "..");
const RADAR_PATH = path.join(ROOT, "frontend", "data", "radar.json");
const HISTORY_PATH = path.join(
    ROOT,
    "frontend",
    "data",
    "external-market-history.json"
);

const HORIZONS = [14, 30, 60, 90];

const WEIGHTS = {
    14: 0.35,
    30: 0.30,
    60: 0.20,
    90: 0.15
};

const CM_PRODUCTS =
    "https://downloads.s3.cardmarket.com/productCatalog/productList/products_singles_1.json";

const CM_PRICES =
    "https://downloads.s3.cardmarket.com/productCatalog/priceGuide/price_guide_1.json";

const MTGJSON_SETLIST =
    "https://mtgjson.com/api/v5/SetList.json";

const MTGJSON_ALL =
    "https://mtgjson.com/api/v5/AllPrices.json.gz";

const MTGJSON_TODAY =
    "https://mtgjson.com/api/v5/AllPricesToday.json.gz";

const FX_URL =
    "https://api.frankfurter.dev/v2/rate/USD/EUR?providers=ECB";


/*
 * Le catalogue public Cardmarket ne contient
 * pas le nom de l'extension.
 *
 * Fallback uniquement lorsque MTGJSON ne
 * permet pas d'identifier l'impression.
 *
 * IMPORTANT :
 * on ne remplace jamais FWB par Revised.
 */
const CM_EXPANSION_FALLBACK = {
    "foreign white border": 73,
    "foreign white bordered": 73,
    "fwb": 73,

    "foreign black border": 57,
    "foreign black bordered": 57,
    "fbb": 57
};


const SET_ALIASES = {
    "revised": "3ED",
    "revised edition": "3ED",

    "unlimited": "2ED",
    "unlimited edition": "2ED",

    "arabian nights": "ARN",
    "antiquities": "ATQ",
    "legends": "LEG",
    "the dark": "DRK",
    "fallen empires": "FEM",
    "ice age": "ICE",
    "alliances": "ALL",
    "mirage": "MIR",
    "visions": "VIS",
    "weatherlight": "WTH",
    "tempest": "TMP",
    "stronghold": "STH",
    "exodus": "EXO",

    "urza's saga": "USG",
    "urzas saga": "USG",

    "urza's legacy": "ULG",
    "urza's destiny": "UDS",

    "foreign white border": "FWB",
    "foreign white bordered": "FWB",
    "fwb": "FWB",

    "foreign black border": "FBB",
    "foreign black bordered": "FBB",
    "fbb": "FBB"
};


function normalize(value) {

    return String(value || "")
        .trim()
        .toLowerCase()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/[’‘`]/g, "'")
        .replace(/[^a-z0-9']+/g, " ")
        .trim();
}

function splitCardVariant(name) {

    const value =
        String(name || "").trim();

    const match =
        value.match(
            /\s*\(V\.\s*(\d+)\)\s*$/i
        );

    return {
        baseName:
            match
                ? value
                    .slice(0, match.index)
                    .trim()
                : value,

        variant:
            match
                ? Number(match[1])
                : null
    };
}


function keyOf(row) {

    return [
        row.nomCarte,
        row.edition,
        row.langue
    ]
        .map(normalize)
        .join("||");
}


function round(value, digits = 2) {

    return Number.isFinite(Number(value))
        ? Number(Number(value).toFixed(digits))
        : null;
}


function readJson(file, fallback) {

    try {
        return JSON.parse(
            fs.readFileSync(file, "utf8")
        );
    } catch {
        return fallback;
    }
}


function writeJson(file, value) {

    fs.mkdirSync(
        path.dirname(file),
        { recursive: true }
    );

    fs.writeFileSync(
        file,
        JSON.stringify(value, null, 2),
        "utf8"
    );
}


function getBuffer(url) {

    return new Promise((resolve, reject) => {

        https.get(
            url,
            {
                headers: {
                    "User-Agent": "mtg-portfolio/1.0"
                }
            },
            response => {

                if (
                    response.statusCode >= 300 &&
                    response.statusCode < 400 &&
                    response.headers.location
                ) {

                    response.resume();

                    return getBuffer(
                        new URL(
                            response.headers.location,
                            url
                        ).href
                    ).then(resolve, reject);
                }

                if (response.statusCode !== 200) {

                    return reject(
                        new Error(
                            `HTTP ${response.statusCode}: ${url}`
                        )
                    );
                }

                const chunks = [];

                response.on(
                    "data",
                    chunk => chunks.push(chunk)
                );

                response.on(
                    "end",
                    () => resolve(
                        Buffer.concat(chunks)
                    )
                );
            }
        ).on("error", reject);
    });
}


async function getJson(url) {

    return JSON.parse(
        (
            await getBuffer(url)
        ).toString("utf8")
    );
}


function extractRows(object) {

    if (Array.isArray(object)) {
        return object;
    }

    for (
        const key of [
            "products",
            "prices",
            "priceGuide",
            "priceGuides",
            "data",
            "result",
            "results"
        ]
    ) {

        if (Array.isArray(object?.[key])) {
            return object[key];
        }
    }

    return [];
}


function setCodeFor(edition, setList) {

    const normalized =
        normalize(edition);

    if (SET_ALIASES[normalized]) {
        return SET_ALIASES[normalized];
    }

    const exact =
        setList.find(
            set =>
                normalize(set.name) === normalized ||
                normalize(set.code) === normalized
        );

    return exact?.code || null;
}


async function buildMappings(
    printings,
    products
) {

    const setList =
        (
            await getJson(
                MTGJSON_SETLIST
            )
        )?.data || [];

    const setCache =
        new Map();

    const byName =
        new Map();


    for (const product of products) {

        const name =
            normalize(product.name);

        if (!byName.has(name)) {
            byName.set(name, []);
        }

        byName
            .get(name)
            .push(product);
    }


    const mappings =
        new Map();


    for (const printing of printings) {

        const key =
            keyOf(printing);

        const code =
            setCodeFor(
                printing.edition,
                setList
            );

        let card = null;


        if (code) {

            if (!setCache.has(code)) {

                try {

                    const data =
                        await getJson(
                            `https://mtgjson.com/api/v5/${code}.json`
                        );

                    setCache.set(
                        code,
                        data?.data?.cards || []
                    );

                } catch {

                    setCache.set(
                        code,
                        []
                    );
                }
            }


            const printingVariant =
    splitCardVariant(
        printing.nomCarte
    );


const matches =
    setCache
        .get(code)
        .filter(
            candidate =>
                normalize(candidate.name) ===
                normalize(
                    printingVariant.baseName
                )
        );


            card =
                matches.find(
                    candidate =>
                        normalize(candidate.language) ===
                        normalize(printing.langue)
                ) ||
                matches[0] ||
                null;
        }


        let mcmId =
            card?.identifiers?.mcmId ||
            null;


        /*
         * FWB/FBB :
         *
         * si MTGJSON ne fournit pas la carte,
         * on recherche le produit Cardmarket
         * dans l'extension exacte.
         *
         * Aucun fallback vers Revised.
         */
        if (!mcmId) {

            const expansionId =
                CM_EXPANSION_FALLBACK[
                    normalize(printing.edition)
                ];


            if (expansionId) {

                const candidates =
                    (
                        byName.get(
                            normalize(
                                printing.nomCarte
                            )
                        ) || []
                    ).filter(
                        product =>
                            Number(
                                product.idExpansion
                            ) === expansionId
                    );


                if (candidates.length === 1) {

                    mcmId =
                        String(
                            candidates[0].idProduct
                        );
                }
            }
        }


        mappings.set(
            key,
            {
                mtgjsonUuid:
                    card?.uuid || null,

                cardmarketProductId:
                    mcmId
                        ? String(mcmId)
                        : null,

                tcgplayerProductId:
                    card?.identifiers
                        ?.tcgplayerProductId ||
                    null,

                setCode:
                    code
            }
        );
    }


    return mappings;
}


async function selectedMtgjsonPrices(
    url,
    wanted
) {

    if (!wanted.size) {
        return new Map();
    }


    const compressed =
        await getBuffer(url);


    const input =
        require("stream")
            .Readable
            .from(compressed);


    const gunzip =
        zlib.createGunzip();

    const jsonParser =
        parser.asStream();

    const dataPicker =
        pick.asStream({
            filter: "data"
        });

    const objectStreamer =
        streamObject.asStream();


    input
        .pipe(gunzip)
        .pipe(jsonParser)
        .pipe(dataPicker)
        .pipe(objectStreamer);


    const result =
        new Map();


    await new Promise(
        (resolve, reject) => {

            objectStreamer.on(
                "data",
                ({ key, value }) => {

                    if (wanted.has(key)) {
                        result.set(
                            key,
                            value
                        );
                    }
                }
            );


            objectStreamer.on(
                "end",
                resolve
            );


            objectStreamer.on(
                "error",
                reject
            );


            gunzip.on(
                "error",
                reject
            );
        }
    );


    return result;
}

function cardmarketTrendSeries(object) {

    const source =
        object
            ?.paper
            ?.cardmarket
            ?.retail
            ?.normal;

    if (
        !source ||
        typeof source !== "object"
    ) {
        return [];
    }

    return Object
        .entries(source)
        .map(
            ([date, price]) => ({
                date,
                price: Number(price)
            })
        )
        .filter(
            row =>
                /^\d{4}-\d{2}-\d{2}$/
                    .test(row.date) &&
                Number.isFinite(row.price) &&
                row.price > 0
        )
        .sort(
            (a, b) =>
                a.date.localeCompare(b.date)
        );
}


function tcgSeries(object) {

    const source =
        object
            ?.paper
            ?.tcgplayer
            ?.retail
            ?.normal;


    if (
        !source ||
        typeof source !== "object"
    ) {
        return [];
    }


    return Object
        .entries(source)
        .map(
            ([date, price]) => ({
                date,
                price: Number(price)
            })
        )
        .filter(
            row =>
                /^\d{4}-\d{2}-\d{2}$/
                    .test(row.date) &&
                Number.isFinite(row.price) &&
                row.price > 0
        )
        .sort(
            (a, b) =>
                a.date.localeCompare(b.date)
        );
}


function mergeSeries(
    existing,
    incoming
) {

    const map =
        new Map(
            (existing || [])
                .map(
                    row => [
                        row.date,
                        row
                    ]
                )
        );


    for (const row of incoming || []) {

        map.set(
            row.date,
            row
        );
    }


    return [
        ...map.values()
    ]
        .sort(
            (a, b) =>
                a.date.localeCompare(b.date)
        )
        .slice(-100);
}


function regression(rows) {

    if (rows.length < 2) {
        return null;
    }


    const firstTimestamp =
        new Date(
            rows[0].date +
            "T12:00:00Z"
        ).getTime();


    const points =
        rows.map(
            row => ({
                x:
                    (
                        new Date(
                            row.date +
                            "T12:00:00Z"
                        ).getTime() -
                        firstTimestamp
                    ) /
                    86400000,

                y: row.price
            })
        );


    const count =
        points.length;


    const averageX =
        points.reduce(
            (sum, point) =>
                sum + point.x,
            0
        ) / count;


    const averageY =
        points.reduce(
            (sum, point) =>
                sum + point.y,
            0
        ) / count;


    let covariance = 0;
    let varianceX = 0;


    for (const point of points) {

        covariance +=
            (
                point.x -
                averageX
            ) *
            (
                point.y -
                averageY
            );


        varianceX +=
            (
                point.x -
                averageX
            ) ** 2;
    }


    if (!varianceX) {
        return null;
    }


    const slope =
        covariance /
        varianceX;


    const intercept =
        averageY -
        slope * averageX;


    let totalVariation = 0;
    let residualVariation = 0;


    for (const point of points) {

        const predicted =
            intercept +
            slope * point.x;


        totalVariation +=
            (
                point.y -
                averageY
            ) ** 2;


        residualVariation +=
            (
                point.y -
                predicted
            ) ** 2;
    }


    const rSquared =
        totalVariation < 1e-12
            ? 0
            : Math.max(
                0,
                Math.min(
                    1,
                    1 -
                    residualVariation /
                    totalVariation
                )
            );


    const start =
        intercept;


    const end =
        intercept +
        slope *
        points[
            points.length - 1
        ].x;


    return {
        trendPct:
            start > 0
                ? (
                    (
                        end -
                        start
                    ) /
                    start
                ) * 100
                : null,

        rSquared,

        slope
    };
}


function percentile(values, p) {

    const clean =
        values
            .filter(Number.isFinite)
            .sort((a, b) => a - b);

    if (!clean.length) {
        return null;
    }

    const index =
        Math.floor(
            (clean.length - 1) * p
        );

    return clean[index];
}


function accelerationMetrics(series) {

    if (
        !Array.isArray(series) ||
        series.length < 30
    ) {
        return {
            available: false
        };
    }


    const clean =
        series
            .filter(
                row =>
                    /^\d{4}-\d{2}-\d{2}$/
                        .test(row.date) &&
                    Number.isFinite(
                        Number(row.price)
                    ) &&
                    Number(row.price) > 0
            )
            .map(
                row => ({
                    date: row.date,
                    price: Number(row.price)
                })
            )
            .sort(
                (a, b) =>
                    a.date.localeCompare(b.date)
            );


    if (clean.length < 30) {
        return {
            available: false
        };
    }


    const DAY = 86400000;

    const latestTime =
        new Date(
            clean.at(-1).date +
            "T12:00:00Z"
        ).getTime();


    /*
     * Les trois horizons ne sont plus
     * en concurrence.
     *
     * 14j = mouvement ACTUEL
     * 21j = confirmation intermédiaire
     * 30j = tendance de fond
     */
    const windows = {};


    for (const days of [14, 21, 30]) {

        const start =
            latestTime -
            (days - 1) * DAY;


        const rows =
            clean.filter(row => {

                const time =
                    new Date(
                        row.date +
                        "T12:00:00Z"
                    ).getTime();

                return (
                    time >= start &&
                    time <= latestTime
                );
            });


        const minimumPoints =
            Math.max(
                8,
                Math.floor(days * 0.60)
            );


        if (
            rows.length < minimumPoints
        ) {

            windows[days] = {
                available: false,
                observations:
                    rows.length
            };

            continue;
        }


        const reg =
            regression(rows);


        if (!reg) {

            windows[days] = {
                available: false,
                observations:
                    rows.length
            };

            continue;
        }


        const average =
            rows.reduce(
                (sum, row) =>
                    sum + row.price,
                0
            ) /
            rows.length;


        const slopePctPerDay =
            average > 0
                ? (
                    reg.slope /
                    average
                ) * 100
                : null;


        windows[days] = {

            available: true,

            trendPct:
                round(
                    reg.trendPct,
                    2
                ),

            slopePctPerDay:
                round(
                    slopePctPerDay,
                    3
                ),

            rSquared:
                round(
                    reg.rSquared,
                    3
                ),

            observations:
                rows.length
        };
    }


    const h14 =
        windows[14];

    const h21 =
        windows[21];

    const h30 =
        windows[30];


    if (
        !h14?.available ||
        !h21?.available ||
        !h30?.available
    ) {

        return {
            available: false,
            windows
        };
    }


    /*
     * Accélération actuelle :
     *
     * on compare la pente 14j à une
     * référence constituée des tendances
     * plus longues.
     */
    const referenceSlope =
        (
            h21.slopePctPerDay +
            h30.slopePctPerDay
        ) / 2;


    const accelerationPctPerDay =
        h14.slopePctPerDay -
        referenceSlope;


    /*
     * Ratio de maintien :
     *
     * proche de 1 :
     * le mouvement 14j reste cohérent
     * avec le 21j.
     *
     * très inférieur à 1 :
     * essoufflement.
     */
    const continuationRatio =
        h21.trendPct > 0
            ? h14.trendPct /
                h21.trendPct
            : null;


    return {

        available: true,

        windows,

        trend14:
            h14.trendPct,

        trend21:
            h21.trendPct,

        trend30:
            h30.trendPct,

        slope14:
            h14.slopePctPerDay,

        slope21:
            h21.slopePctPerDay,

        slope30:
            h30.slopePctPerDay,

        accelerationPctPerDay:
            round(
                accelerationPctPerDay,
                3
            ),

        continuationRatio:
            continuationRatio === null
                ? null
                : round(
                    continuationRatio,
                    2
                ),

        rSquared14:
            h14.rSquared
    };
}


function classifyAcceleration(
    metrics,
    thresholds
) {

    if (
        !metrics?.available ||
        !thresholds
    ) {

        return {
            ...metrics,
            signal: "—",
            level: 0
        };
    }


    const {
        trend14,
        trend21,
        trend30,
        slope14,
        accelerationPctPerDay,
        continuationRatio,
        rSquared14
    } = metrics;


    /*
     * 🚀 RUPTURE
     *
     * - mouvement dans les ~3 % les
     *   plus forts du marché
     * - minimum absolu
     * - pente actuelle positive
     * - accélération réelle
     * - mouvement statistiquement
     *   suffisamment propre
     * - pas d'essoufflement récent
     */
    const breakout =
        trend14 >= thresholds.p97 &&
        trend14 >= thresholds.breakoutFloor &&
        slope14 > 0 &&
        accelerationPctPerDay >=
            thresholds.breakoutAcceleration &&
        rSquared14 >= 0.45 &&
        (
            continuationRatio === null ||
            continuationRatio >= 0.85
        );


    /*
     * ⚡ ACCÉLÉRATION
     *
     * P90 + accélération positive.
     */
    const accelerating =
        trend14 >= thresholds.p90 &&
        trend14 >= thresholds.accelerationFloor &&
        slope14 > 0 &&
        accelerationPctPerDay >=
            thresholds.accelerationMinimum &&
        rSquared14 >= 0.30 &&
        (
            continuationRatio === null ||
            continuationRatio >= 0.45
        );


    /*
     * ↘ ESSOUFFLEMENT
     *
     * Le mouvement moyen/long était
     * positif mais le 14j a fortement
     * perdu de sa vigueur.
     */
    const fading =
        trend21 >= thresholds.accelerationFloor &&
        trend30 > 0 &&
        (
            trend14 <= trend21 * 0.40 ||
            accelerationPctPerDay < 0
        );


    /*
     * ↗ HAUSSE INSTALLÉE
     *
     * Les trois horizons restent
     * positifs sans nouvelle rupture.
     */
    const established =
        trend14 > 0 &&
        trend21 > 0 &&
        trend30 > 0 &&
        rSquared14 >= 0.20;


    let signal = "—";
    let level = 0;


    if (breakout) {

        signal =
            "🚀 Rupture";

        level = 2;

    } else if (accelerating) {

        signal =
            "⚡ Accélération";

        level = 1;

    } else if (fading) {

        signal =
            "↘ Essoufflement";

        level = -2;

    } else if (established) {

        signal =
            "↗ Hausse installée";

        level = -1;
    }


    return {
        ...metrics,
        signal,
        level
    };
}

function analyzeMarket(
    series,
    sparse = false
) {

    const horizons = {};

    let weighted = 0;
    let weightUsed = 0;


    for (const days of HORIZONS) {

        const latest =
            series.at(-1);


        if (!latest) {

            horizons[
                `${days}d`
            ] = {
                available: false
            };

            continue;
        }


        const cutoff =
            new Date(
                latest.date +
                "T12:00:00Z"
            ).getTime() -
            (
                days - 1
            ) *
            86400000;


        const rows =
            series.filter(
                row =>
                    new Date(
                        row.date +
                        "T12:00:00Z"
                    ).getTime() >=
                    cutoff
            );


        const span =
            rows.length > 1
                ? Math.round(
                    (
                        new Date(
                            rows.at(-1).date
                        ) -
                        new Date(
                            rows[0].date
                        )
                    ) /
                    86400000
                )
                : 0;


        const minimumPoints =
            sparse
                ? Math.max(
                    4,
                    Math.ceil(
                        days * 0.25
                    )
                )
                : Math.max(
                    5,
                    Math.ceil(
                        days * 0.6
                    )
                );


        const available =
            rows.length >=
                minimumPoints &&
            span >=
                Math.floor(
                    (
                        days - 1
                    ) *
                    0.8
                );


        if (!available) {

            horizons[
                `${days}d`
            ] = {
                available: false,
                observations:
                    rows.length,
                spanDays:
                    span
            };

            continue;
        }


        const reg =
            regression(rows);


        const raw =
            (
                (
                    rows.at(-1).price -
                    rows[0].price
                ) /
                rows[0].price
            ) *
            100;


        horizons[
            `${days}d`
        ] = {
            available: true,

            observations:
                rows.length,

            spanDays:
                span,

            rawPct:
                round(raw),

            trendPct:
                round(
                    reg?.trendPct
                ),

            rSquared:
                round(
                    reg?.rSquared,
                    3
                )
        };


        const normalizeScore =
            value =>
                Math.max(
                    0,
                    Math.min(
                        100,
                        (
                            (
                                value + 2
                            ) /
                            7
                        ) *
                        100
                    )
                );


        const activity =
            Math.min(
                100,
                (
                    rows.length /
                    days
                ) *
                100
            );


        const horizonScore =
            0.40 *
                normalizeScore(
                    reg?.trendPct || 0
                ) +
            0.25 *
                normalizeScore(
                    raw
                ) +
            0.20 *
                (
                    reg?.rSquared || 0
                ) *
                100 +
            0.15 *
                activity;


        weighted +=
            horizonScore *
            WEIGHTS[days];


        weightUsed +=
            WEIGHTS[days];
    }


    const score =
        weightUsed
            ? round(
                weighted /
                weightUsed,
                1
            )
            : null;


    const h14 =
        horizons["14d"];

    const h30 =
        horizons["30d"];

    const h60 =
        horizons["60d"];


    const shortPositive =
        (
            h14?.available &&
            h14.trendPct >= 1
        ) ||
        (
            h30?.available &&
            h30.trendPct >= 2
        );


    const mediumPositive =
        h60?.available &&
        h60.trendPct >= 3;


    const rising =
        score !== null &&
        score >= 55 &&
        (
            shortPositive ||
            mediumPositive
        );


    return {
        score,
        rising,
        horizons
    };
}


async function main() {

    const radar =
        readJson(
            RADAR_PATH,
            null
        );


    if (!radar?.rows) {

        throw new Error(
            "radar.json introuvable ou invalide"
        );
    }


    const history =
        readJson(
            HISTORY_PATH,
            {
                version: 1,
                cards: {}
            }
        );


    history.cards ||= {};

        /*
     * Migration AVG1 -> Trend.
     *
     * Les anciennes observations Cardmarket
     * contiennent des AVG1. Elles ne doivent
     * jamais être mélangées à la nouvelle
     * série Trend.
     */
    if (history.cardmarketMetric !== "TREND") {

        for (
            const entry of
            Object.values(history.cards)
        ) {
            entry.cardmarket = [];
        }

        history.cardmarketMetric =
            "TREND";

        history.cardmarketTrendBackfillCompleted =
            false;
    }


    const printings =
        [
            ...new Map(
                radar.rows.map(
                    row => [
                        keyOf(row),
                        row
                    ]
                )
            ).values()
        ];


    console.log(
        `Marchés externes : ${printings.length} impressions à traiter`
    );


    const [
        productsJson,
        pricesJson,
        fxJson
    ] =
        await Promise.all([
            getJson(CM_PRODUCTS),
            getJson(CM_PRICES),
            getJson(FX_URL)
        ]);


    const products =
        extractRows(
            productsJson
        );


    const prices =
        extractRows(
            pricesJson
        );


    const priceMap =
        new Map(
            prices.map(
                price => [
                    String(
                        price.idProduct
                    ),
                    price
                ]
            )
        );


    const mappings =
        await buildMappings(
            printings,
            products
        );


    const uuids =
        new Set(
            [
                ...mappings.values()
            ]
                .map(
                    mapping =>
                        mapping.mtgjsonUuid
                )
                .filter(Boolean)
        );


const firstBackfill =
    !history.tcgBackfillCompleted ||
    !history.cardmarketTrendBackfillCompleted;


    console.log(
        firstBackfill
            ? "TCGplayer : backfill 90 jours"
            : "TCGplayer : mise à jour quotidienne"
    );


    const mtgPrices =
        await selectedMtgjsonPrices(
            firstBackfill
                ? MTGJSON_ALL
                : MTGJSON_TODAY,
            uuids
        );


    const fx =
        Number(
            fxJson?.rate ||
            fxJson?.rates?.EUR ||
            0
        );


    const today =
        new Date()
            .toISOString()
            .slice(0, 10);


    let mappedCardmarket = 0;
    let mappedTcg = 0;


    for (const printing of printings) {

        const key =
            keyOf(printing);


        const mapping =
            mappings.get(key);


        const entry =
            history.cards[key] ||
            {
                nomCarte:
                    printing.nomCarte,

                edition:
                    printing.edition,

                langue:
                    printing.langue,

                tcg: [],

                cardmarket: []
            };


        entry.mapping =
            mapping;


        if (mapping?.mtgjsonUuid) {

            const mtgPriceObject =
                mtgPrices.get(
                    mapping.mtgjsonUuid
                );


            const incomingTcg =
                tcgSeries(
                    mtgPriceObject
                );


            entry.tcg =
                mergeSeries(
                    entry.tcg,
                    incomingTcg
                );


            /*
             * MTGJSON conserve également
             * l'historique Cardmarket Trend.
             *
             * Au premier backfill, cela permet
             * d'obtenir immédiatement environ
             * 90 jours de Trend Cardmarket.
             */
            const incomingCardmarket =
                cardmarketTrendSeries(
                    mtgPriceObject
                );


            entry.cardmarket =
                mergeSeries(
                    entry.cardmarket,
                    incomingCardmarket
                );


            if (entry.tcg.length) {
                mappedTcg += 1;
            }
        }

        if (
            mapping
                ?.cardmarketProductId
        ) {

            const cardmarket =
                priceMap.get(
                    String(
                        mapping
                            .cardmarketProductId
                    )
                );


                        const trend =
                Number(
                    cardmarket?.trend
                );


            if (
                Number.isFinite(trend) &&
                trend > 0
            ) {

                /*
                 * Cardmarket Trend est la métrique
                 * principale du Radar européen.
                 *
                 * Si MTGJSON fournit un historique
                 * pour cette impression, il est
                 * fusionné plus bas.
                 *
                 * Le Price Guide Cardmarket fournit
                 * toujours le point Trend du jour.
                 */
                entry.cardmarket =
                    mergeSeries(
                        entry.cardmarket,
                        [
                            {
                                date:
                                    today,

                                price:
                                    trend
                            }
                        ]
                    );


                mappedCardmarket += 1;
            }
                entry.cardmarketCurrent =
                cardmarket
                    ? {
                        avg1:
                            round(
                                cardmarket.avg1
                            ),

                        avg7:
                            round(
                                cardmarket.avg7
                            ),

                        avg30:
                            round(
                                cardmarket.avg30
                            ),

                        trend:
                            round(
                                cardmarket.trend
                            )
                    }
                    : null;
        }


        history.cards[key] =
            entry;
    }


    history.tcgBackfillCompleted =
        true;
    history.cardmarketTrendBackfillCompleted =
    true;


    history.updatedAt =
        new Date()
            .toISOString();


    history.usdEur =
        Number.isFinite(fx) &&
        fx > 0
            ? fx
            : null;


    writeJson(
        HISTORY_PATH,
        history
    );


/*
 * =========================================================
 * MOMENTUM V2
 *
 * Les seuils sont recalculés quotidiennement
 * séparément pour TCGplayer et Cardmarket.
 * =========================================================
 */

const uniqueMomentumEntries =
    [
        ...new Map(
            radar.rows.map(
                row => [
                    [
                        normalize(row.nomCarte),
                        normalize(row.edition)
                    ].join("||"),
                    row
                ]
            )
        ).values()
    ];


const tcgMetricsByKey =
    new Map();

const cardmarketMetricsByKey =
    new Map();


const tcg14Values = [];
const cardmarket14Values = [];


for (
    const row of
    uniqueMomentumEntries
) {

    const historyEntry =
        history.cards[
            keyOf(row)
        ] || {};


    const tcgMetrics =
        accelerationMetrics(
            historyEntry.tcg || []
        );


    const cardmarketMetrics =
        accelerationMetrics(
            historyEntry.cardmarket || []
        );


    const momentumKey =
        [
            normalize(row.nomCarte),
            normalize(row.edition)
        ].join("||");


    tcgMetricsByKey.set(
        momentumKey,
        tcgMetrics
    );


    cardmarketMetricsByKey.set(
        momentumKey,
        cardmarketMetrics
    );


    if (
        tcgMetrics.available &&
        Number.isFinite(
            tcgMetrics.trend14
        )
    ) {

        tcg14Values.push(
            tcgMetrics.trend14
        );
    }


    if (
        cardmarketMetrics.available &&
        Number.isFinite(
            cardmarketMetrics.trend14
        )
    ) {

        cardmarket14Values.push(
            cardmarketMetrics.trend14
        );
    }
}


const tcgMomentumThresholds = {

    p90:
        percentile(
            tcg14Values,
            0.90
        ),

    p97:
        percentile(
            tcg14Values,
            0.97
        ),

    accelerationFloor:
        5,

    breakoutFloor:
        10,

    accelerationMinimum:
        0.05,

    breakoutAcceleration:
        0.10
};


const cardmarketMomentumThresholds = {

    p90:
        percentile(
            cardmarket14Values,
            0.90
        ),

    p97:
        percentile(
            cardmarket14Values,
            0.97
        ),

    accelerationFloor:
        12,

    breakoutFloor:
        25,

    accelerationMinimum:
        0.10,

    breakoutAcceleration:
        0.20
};


console.log(
    "Momentum TCG :",
    tcgMomentumThresholds
);


console.log(
    "Momentum Cardmarket :",
    cardmarketMomentumThresholds
);

    radar.rows =
        radar.rows.map(row => {

            const entry =
                history.cards[
                    keyOf(row)
                ] || {};


            const tcg =
                analyzeMarket(
                    entry.tcg || [],
                    false
                );


                       /*
             * Cardmarket Trend :
             * série historique utilisée pour
             * mesurer le momentum européen.
             */
            const cardmarket =
                analyzeMarket(
                    entry.cardmarket || [],
                    false
                );


            const latestUsd =
                entry.tcg
                    ?.at(-1)
                    ?.price ||
                null;


                        const cardmarketTrend =
                entry
                    .cardmarketCurrent
                    ?.trend ??
                null;


                const momentumKey =
    [
        normalize(row.nomCarte),
        normalize(row.edition)
    ].join("||");


const tcgMomentum =
    classifyAcceleration(
        tcgMetricsByKey.get(
            momentumKey
        ),
        tcgMomentumThresholds
    );


const cardmarketMomentum =
    classifyAcceleration(
        cardmarketMetricsByKey.get(
            momentumKey
        ),
        cardmarketMomentumThresholds
    );


const tcgPriceEur =
    latestUsd &&
    fx
        ? latestUsd * fx
        : null;


const usEuPct =
    Number.isFinite(tcgPriceEur) &&
    tcgPriceEur > 0 &&
    Number.isFinite(
        Number(cardmarketTrend)
    ) &&
    Number(cardmarketTrend) > 0

        ? (
            (
                tcgPriceEur -
                Number(cardmarketTrend)
            ) /
            Number(cardmarketTrend)
        ) * 100

        : null;


/*
 * Momentum global.
 *
 * Une rupture simultanée sur les deux
 * marchés constitue le signal maximal.
 */
let momentumSignal = "—";


if (
    tcgMomentum.level === 2 &&
    cardmarketMomentum.level === 2
) {

    momentumSignal =
        "🚀 Rupture confirmée";

} else if (
    tcgMomentum.level === 2
) {

    momentumSignal =
        "🚀 Rupture US";

} else if (
    cardmarketMomentum.level === 2
) {

    momentumSignal =
        "🚀 Rupture EU";

} else if (
    tcgMomentum.level === 1 &&
    cardmarketMomentum.level === 1
) {

    momentumSignal =
        "⚡ Accélération confirmée";

} else if (
    tcgMomentum.level === 1
) {

    momentumSignal =
        "⚡ Accélération US";

} else if (
    cardmarketMomentum.level === 1
) {

    momentumSignal =
        "⚡ Accélération EU";
}


            let finalSignal =
                "— Neutre";


            if (
                tcg.rising &&
                cardmarket.rising
            ) {

                finalSignal =
                    "🔥 Hausse confirmée";

            } else if (tcg.rising) {

                finalSignal =
                    "🇺🇸 Hausse TCG";

            } else if (
                cardmarket.rising
            ) {

                finalSignal =
                    "🇪🇺 Hausse Cardmarket";

                        } else if (
                !cardmarket
                    .horizons
                    ?.["14d"]
                    ?.available
            ) {

                finalSignal =
                    "🧪 Apprentissage";
            }


            return {
                ...row,

                marketRadar: {

    finalSignal,

    momentumSignal,

    usEuPct:
        round(
            usEuPct,
            1
        ),

    momentum: {
        tcg:
            tcgMomentum,

        cardmarket:
            cardmarketMomentum
    },

    tcg: {
                        ...tcg,

                        currentPriceUsd:
                            round(
                                latestUsd
                            ),

                        currentPriceEur:
    round(
        tcgPriceEur
    ),

                        observations:
                            entry.tcg
                                ?.length ||
                            0
                    },

                    cardmarket: {
                        ...cardmarket,

                        cardmarketTrend,

                        avg7:
                            entry
                                .cardmarketCurrent
                                ?.avg7 ??
                            null,

                        avg30:
                            entry
                                .cardmarketCurrent
                                ?.avg30 ??
                            null,

                        trend:
                            entry
                                .cardmarketCurrent
                                ?.trend ??
                            null,

                        observations:
                            entry.cardmarket
                                ?.length ||
                            0
                    },

                    mapping:
                        entry.mapping ||
                        null
                }
            };
        });


    radar.externalMarkets = {

        updatedAt:
            new Date()
                .toISOString(),

        usdEur:
            history.usdEur,

        tcgBackfillCompleted:
            true,

        cardmarketMetric:
            "Cardmarket Trend",

        tcgMetric:
            "MTGJSON paper.tcgplayer.retail.normal"
    };


    writeJson(
        RADAR_PATH,
        radar
    );


        console.log(
        `Cardmarket mappé avec Trend : ${mappedCardmarket}/${printings.length}`
    );

    console.log(
        `TCGplayer avec historique : ${mappedTcg}/${printings.length}`
    );

    console.log(
        `Radar enrichi : ${RADAR_PATH}`
    );
}


main().catch(error => {

    console.error(error);

    process.exit(1);
});