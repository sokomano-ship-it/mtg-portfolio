const nodemailer = require("nodemailer");
const fs = require("fs");
const path = require("path");

const radarPath = path.join(
    __dirname,
    "..",
    "frontend",
    "data",
    "radar.json"
);
const alertsHistoryPath = path.join(__dirname, "..", "frontend", "data", "alerts-history.json");

const {
    SMTP_HOST,
    SMTP_PORT,
    SMTP_USER,
    SMTP_PASS,
    ALERT_EMAIL_TO
} = process.env;

function formatEuro(value) {
    return new Intl.NumberFormat("fr-FR", {
        style: "currency",
        currency: "EUR"
    }).format(Number(value) || 0);
}

function formatPercent(value) {
    const n = Number(value || 0);
    return `${n >= 0 ? "+" : ""}${n.toFixed(1)} %`;
}

function formatOptionalPercent(value) {

    if (
        value === null ||
        value === undefined ||
        value === ""
    ) {
        return "-";
    }

    const number =
        Number(value);

    if (!Number.isFinite(number)) {
        return "-";
    }

    return formatPercent(number);
}

function todayIsoDate() {
    return new Date().toISOString().slice(0, 10);
}

function loadJson(filePath, fallback) {
    if (!fs.existsSync(filePath)) return fallback;

    try {
        return JSON.parse(fs.readFileSync(filePath, "utf8"));
    } catch {
        return fallback;
    }
}

function saveJson(filePath, data) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), "utf8");
}

function alertKey(alert) {
    return [
        alert.date,
        alert.nomCarte,
        alert.edition || "",
        alert.version || "",
        alert.langue || ""
    ].join("|");
}

function saveAlertsHistory(alerts) {
    const previous = loadJson(alertsHistoryPath, []);
    const existingKeys = new Set(previous.map(alertKey));
    const today = todayIsoDate();

    const newRows = alerts.map(card => ({
        date: today,
        nomCarte: card.nomCarte,
        edition: card.edition || "",
        version: card.version || "",
        langue: card.langue || "",
        ownedLabel: card.ownedLabel || "Non",
        quantityOwned: Number(card.quantityOwned || 0),
        ownedStates: card.ownedStates || "-",
        nmPriceAtAlert: Number(card.nmPrice || card.trendPrice || 0),
        nmTargetPrice: Number(card.nmTargetPrice || 0),
        exTargetPrice: Number(card.exTargetPrice || 0),
        buyProbability: Number(card.buyProbability || 0),
        timingScore: Number(card.timingScore || 0),
        momentumQuality: Number(card.momentumQuality || 0),
        trendQuality: Number(card.trendQuality || 0),
        remainingPotential: Number(card.remainingPotential || 0),
        trendVs30: Number(card.trendVs30 || 0),
        avg1Vs7: Number(card.avg1Vs7 || 0),
        riskMultiplier: Number(card.riskMultiplier || 0),
        decision: card.decision || "",
        reasons: card.reasons || [],
        warnings: card.warnings || []
    }));

    const merged = [...previous];

    newRows.forEach(row => {
        if (!existingKeys.has(alertKey(row))) {
            merged.push(row);
            existingKeys.add(alertKey(row));
        }
    });

    saveJson(alertsHistoryPath, merged);
}

function escapeHtml(value) {
    return String(value || "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

function listHtml(items, icon) {
    if (!Array.isArray(items) || items.length === 0) {
        return "<li>Aucun élément notable.</li>";
    }

    return items
        .map(item => `<li>${icon} ${escapeHtml(item)}</li>`)
        .join("");
}

function getMomentumLabel(card) {
    const momentum = Number(card.momentumQuality || 0);
    const avg1Vs7 = Number(card.avg1Vs7 || 0);
    const trendVs30 = Number(card.trendVs30 || 0);

    if (momentum >= 80 || avg1Vs7 >= 8) return "Forte hausse";
    if (momentum >= 65 || avg1Vs7 >= 4) return "Hausse";
    if (momentum >= 50 || trendVs30 >= 0) return "À surveiller";

    return "Neutre";
}

function getMarketTrend(
    market,
    days
) {

    const horizon =
        market?.horizons?.[`${days}d`];

    if (
        horizon?.available !== true
    ) {
        return null;
    }


    const value =
        Number(
            horizon.trendPct
        );


    return Number.isFinite(value)
        ? value
        : null;
}


function getExternalRadarAssessment(
    marketRadar
) {

    const tcg =
        marketRadar?.tcg || {};

    const cardmarket =
        marketRadar?.cardmarket || {};


    const cardmarketTrend =
        Number(
            cardmarket.cardmarketTrend
        );


    if (
        !Number.isFinite(
            cardmarketTrend
        ) ||
        cardmarketTrend <= 5
    ) {

        return {
            eligible: false,
            score: 0,
            type: null
        };
    }


    const values = {

        tcg14:
            getMarketTrend(
                tcg,
                14
            ),

        tcg30:
            getMarketTrend(
                tcg,
                30
            ),

        tcg60:
            getMarketTrend(
                tcg,
                60
            ),

        tcg90:
            getMarketTrend(
                tcg,
                90
            ),

        cm14:
            getMarketTrend(
                cardmarket,
                14
            ),

        cm30:
            getMarketTrend(
                cardmarket,
                30
            ),

        cm60:
            getMarketTrend(
                cardmarket,
                60
            ),

        cm90:
            getMarketTrend(
                cardmarket,
                90
            )

    };


    const positive =
        value =>
            Number.isFinite(
                Number(value)
            ) &&
            Number(value) > 0;


    const nonNegative =
        value =>
            Number.isFinite(
                Number(value)
            ) &&
            Number(value) >= 0;


    const signal =
        marketRadar?.finalSignal ||
        "— Neutre";


    const momentum =
        marketRadar?.momentumSignal ||
        "—";


    const persistenceCount =
        [
            values.tcg30,
            values.tcg60,
            values.tcg90,
            values.cm30,
            values.cm60,
            values.cm90
        ].filter(
            positive
        ).length;


    const tcgPersistent =
        [
            values.tcg30,
            values.tcg60,
            values.tcg90
        ].filter(
            positive
        ).length;


    const cmPersistent =
        [
            values.cm30,
            values.cm60,
            values.cm90
        ].filter(
            positive
        ).length;


    const cross30 =
        positive(values.tcg30) &&
        positive(values.cm30);


    const cross60 =
        positive(values.tcg60) &&
        positive(values.cm60);


    const cross90 =
        positive(values.tcg90) &&
        positive(values.cm90);


    const persistentTrend =
        signal ===
            "🔥 Hausse confirmée" &&
        persistenceCount >= 4 &&
        tcgPersistent >= 1 &&
        cmPersistent >= 1;


    const confirmedMomentum =
        momentum ===
            "🚀 Rupture confirmée" ||
        momentum ===
            "⚡ Accélération confirmée";


    const usBreakoutConfirmed =
        momentum ===
            "🚀 Rupture US" &&
        (
            positive(values.cm14) ||
            positive(values.cm30)
        );


    const euBreakoutConfirmed =
        momentum ===
            "🚀 Rupture EU" &&
        (
            positive(values.tcg14) ||
            positive(values.tcg30)
        );


    const accelerationWithTrend =
        (
            momentum ===
                "⚡ Accélération US" ||
            momentum ===
                "⚡ Accélération EU"
        ) &&
        signal ===
            "🔥 Hausse confirmée" &&
        (
            cross30 ||
            (
                positive(values.tcg14) &&
                positive(values.cm14)
            )
        );


    const momentumAlert =
        confirmedMomentum ||
        usBreakoutConfirmed ||
        euBreakoutConfirmed ||
        accelerationWithTrend;


    const strongTcgTrend =
        signal ===
            "🇺🇸 Hausse TCG" &&
        positive(values.tcg30) &&
        positive(values.tcg60) &&
        Number(values.tcg30) >= 2 &&
        (
            nonNegative(values.cm30) ||
            nonNegative(values.cm60)
        );


    const strongCardmarketTrend =
        signal ===
            "🇪🇺 Hausse Cardmarket" &&
        positive(values.cm30) &&
        positive(values.cm60) &&
        Number(values.cm30) >= 2 &&
        (
            nonNegative(values.tcg30) ||
            nonNegative(values.tcg60)
        );


    const strongSingleMarketTrend =
        strongTcgTrend ||
        strongCardmarketTrend;


    let score = 0;


    if (
        signal ===
        "🔥 Hausse confirmée"
    ) {
        score += 30;
    }


    if (
        signal === "🇺🇸 Hausse TCG" ||
        signal === "🇪🇺 Hausse Cardmarket"
    ) {
        score += 16;
    }


    if (
        momentum ===
        "🚀 Rupture confirmée"
    ) {
        score += 25;
    }
    else if (
        momentum.includes("🚀")
    ) {
        score += 16;
    }


    if (
        momentum ===
        "⚡ Accélération confirmée"
    ) {
        score += 20;
    }
    else if (
        momentum.includes("⚡")
    ) {
        score += 10;
    }


    score +=
        persistenceCount * 3;


    if (cross30) {
        score += 10;
    }

    if (cross60) {
        score += 7;
    }

    if (cross90) {
        score += 5;
    }


    if (cardmarketTrend >= 20) {
        score += 3;
    }

    if (cardmarketTrend >= 50) {
        score += 3;
    }

    if (cardmarketTrend >= 100) {
        score += 2;
    }

    score =
    Math.min(
        100,
        score
    );


    const eligible =
        persistentTrend ||
        momentumAlert ||
        strongSingleMarketTrend;


    let type = null;


    if (persistentTrend) {
        type =
            "📈 Hausse persistante";
    }


    if (momentumAlert) {
        type =
            persistentTrend
                ? "🔥 Tendance + momentum"
                : "⚡ Momentum";
    }


    if (
        strongSingleMarketTrend &&
        !persistentTrend &&
        !momentumAlert
    ) {
        type =
            "🌍 Hausse marché";
    }


    return {
        eligible,
        score,
        type,

        cardmarketTrend,

        signal,
        momentum,

        ...values
    };
}


function getRadarAlerts(radarRows) {

    const grouped =
        new Map();


    for (
        const row of radarRows || []
    ) {

        const marketRadar =
            row.marketRadar || {};


        const assessment =
            getExternalRadarAssessment(
                marketRadar
            );


        if (!assessment.eligible) {
            continue;
        }


        const key =
            row.printingKey ||
            [
                row.nomCarte || "",
                row.edition || "",
                row.version || "",
                row.langue || ""
            ].join("|");


        if (!grouped.has(key)) {

            grouped.set(
                key,
                {
                    printingKey:
                        key,

                    nomCarte:
                        row.nomCarte,

                    edition:
                        row.edition,

                    version:
                        row.version ||
                        null,

                    langue:
                        row.langue,

                    owned:
                        Boolean(
                            row.owned
                        ),

                    nmPrice:
                        null,

                    exPrice:
                        null,

                    ...assessment
                }
            );
        }


        const card =
            grouped.get(key);


        if (
            row.condition === "NM"
        ) {

            card.nmPrice =
                Number(
                    row.latestPrice || 0
                ) || null;
        }


        if (
            row.condition === "EX"
        ) {

            card.exPrice =
                Number(
                    row.latestPrice || 0
                ) || null;
        }
    }


    return [
        ...grouped.values()
    ]
        .sort(
            (a, b) =>
                b.score -
                a.score
        )
        .slice(
            0,
            20
        );
}

function buildRadarCardHtml(
    card,
    index
) {

    return `
        <div style="
            border:1px solid #ddd;
            border-radius:8px;
            padding:16px;
            margin-bottom:20px;
        ">

            <h2 style="margin-top:0;">
                ${index + 1}.
                ${escapeHtml(
                    card.nomCarte
                )}
            </h2>

            <p>
                <strong>
                    ${escapeHtml(
                        card.edition || "-"
                    )}
                </strong>

                ${card.version
                    ? " • " +
                        escapeHtml(
                            card.version
                        )
                    : ""}

                • ${escapeHtml(
                    card.langue || "-"
                )}
            </p>


            <h3>🚨 Alerte Radar</h3>

            <p>
                <strong>Priorité :</strong>
                ${card.score} / 100<br>

                <strong>Type :</strong>
                ${escapeHtml(
                    card.type || "-"
                )}<br>

                <strong>Tendance :</strong>
                ${escapeHtml(
                    card.signal || "-"
                )}<br>

                <strong>Momentum :</strong>
                ${escapeHtml(
                    card.momentum || "-"
                )}
            </p>


            <h3>🇪🇺 Cardmarket</h3>

            <p>
                <strong>Trend :</strong>
                ${formatEuro(
                    card.cardmarketTrend
                )}<br>

                <strong>14j :</strong>
                ${formatOptionalPercent(
                    card.cm14
                )}<br>

                <strong>30j :</strong>
                ${formatOptionalPercent(
                    card.cm30
                )}<br>

                <strong>60j :</strong>
                ${formatOptionalPercent(
                    card.cm60
                )}<br>

                <strong>90j :</strong>
                ${formatOptionalPercent(
                    card.cm90
                )}
            </p>


            <h3>🇺🇸 TCGplayer</h3>

            <p>
                <strong>14j :</strong>
                ${formatOptionalPercent(
                    card.tcg14
                )}<br>

                <strong>30j :</strong>
                ${formatOptionalPercent(
                    card.tcg30
                )}<br>

                <strong>60j :</strong>
                ${formatOptionalPercent(
                    card.tcg60
                )}<br>

                <strong>90j :</strong>
                ${formatOptionalPercent(
                    card.tcg90
                )}
            </p>


            <h3>💶 Estimation modèle</h3>

            <p>
                <strong>NM :</strong>
                ${
                    card.nmPrice
                        ? formatEuro(
                            card.nmPrice
                        )
                        : "-"
                }<br>

                <strong>EX :</strong>
                ${
                    card.exPrice
                        ? formatEuro(
                            card.exPrice
                        )
                        : "-"
                }
            </p>


            <p style="font-weight:bold;">
                🔎 Action :
                vérifier les annonces Cardmarket
            </p>

        </div>
    `;
}

async function main() {


const radarData =
    loadJson(
        radarPath,
        {}
    );

const radarRows =
    radarData.rows || [];

const radarAlerts =
    getRadarAlerts(
        radarRows
    );

if (
    radarAlerts.length === 0
) {
    console.log(
    "Aucune alerte Radar aujourd'hui, aucun email envoyé."
);

    return;
}



    if (!SMTP_HOST || !SMTP_PORT || !SMTP_USER || !SMTP_PASS || !ALERT_EMAIL_TO) {
        throw new Error("Secrets SMTP manquants.");
    }

    const transporter = nodemailer.createTransport({
        host: SMTP_HOST,
        port: Number(SMTP_PORT),
        secure: Number(SMTP_PORT) === 465,
        auth: {
            user: SMTP_USER,
            pass: SMTP_PASS
        }
    });


const radarCardsHtml =
    radarAlerts
        .map(buildRadarCardHtml)
        .join("");


    const html = `
    <h1>📊 MTG Portfolio — Alertes quotidiennes</h1>

    ${
        radarAlerts.length
            ? `
                <h2>📡 Radar — hausses à vérifier sur Cardmarket</h2>

                <p>
                    Le Radar statistique a identifié
                    <strong>${radarAlerts.length}</strong>
                    carte(s) présentant une hausse suffisamment
                    forte, persistante et propre pour justifier
                    une vérification manuelle des annonces Cardmarket.
                </p>

                <p>
                    Le signal repose principalement sur les
                    tendances 14 / 21 / 30 jours du modèle,
                    leur persistance, le R², le bruit et
                    la confiance du moteur.
                </p>

                ${radarCardsHtml}
            `
            : ""
    }



    <p>
        <a href="https://sokomano-ship-it.github.io/mtg-portfolio/">
            Ouvrir le portefeuille MTG
        </a>
    </p>
`;

    await transporter.sendMail({
        from: `"MTG Portfolio Alerts" <${SMTP_USER}>`,
        to: ALERT_EMAIL_TO,
        subject:
    `📡 ${radarAlerts.length} alerte(s) Radar MTG`,
        html
    });

   console.log(
    `Email envoyé : ` +
    `${radarAlerts.length} alerte(s) Radar.`
);
}

main().catch(error => {
    console.error(error);
    process.exit(1);
});