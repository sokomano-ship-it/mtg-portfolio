const nodemailer = require("nodemailer");
const fs = require("fs");
const path = require("path");
const { getEmailOpportunities } = require("./opportunityScoring");

const opportunitiesPath = path.join(__dirname, "..", "frontend", "data", "opportunities.json");
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

function getRadarAlerts(radarRows) {
    const grouped = new Map();

    for (const row of radarRows || []) {
        if (
    row.signalLevel !== "Hausse forte" ||
    Number(row.convictionScore || 0) < 80 ||
    Number(row.latestPrice || 0) < 3 ||
    !row.horizons?.["30d"]?.available ||
    Number(row.horizons["30d"].rSquared || 0) < 0.70
) {
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
            grouped.set(key, {
                printingKey: key,

                nomCarte: row.nomCarte,
                edition: row.edition,
                version: row.version || null,
                langue: row.langue,

                owned: Boolean(row.owned),
                historySource:
                    row.historySource || "collection",

                nmPrice: null,
                exPrice: null,

                convictionScore: 0,
                signalLevel: row.signalLevel,

                eq14: null,
                eq21: null,
                eq30: null,

                rSquared30: null,
                noise30: null
            });
        }

        const card = grouped.get(key);

        if (row.condition === "NM") {
            card.nmPrice =
                Number(row.latestPrice || 0) || null;
        }

        if (row.condition === "EX") {
            card.exPrice =
                Number(row.latestPrice || 0) || null;
        }

        /*
         * On retient comme référence la série
         * NM/EX ayant la conviction la plus élevée.
         */
        if (
            Number(row.convictionScore || 0) >=
            Number(card.convictionScore || 0)
        ) {
            card.convictionScore =
                Number(row.convictionScore || 0);

            card.signalLevel =
                row.signalLevel;

            card.eq14 =
                row.horizons?.["14d"]?.available
                    ? Number(
                        row.horizons["14d"]
                            .equivalent30dPct
                    )
                    : null;

            card.eq21 =
                row.horizons?.["21d"]?.available
                    ? Number(
                        row.horizons["21d"]
                            .equivalent30dPct
                    )
                    : null;

            card.eq30 =
                row.horizons?.["30d"]?.available
                    ? Number(
                        row.horizons["30d"]
                            .equivalent30dPct
                    )
                    : null;

            card.rSquared30 =
                row.horizons?.["30d"]?.available
                    ? Number(
                        row.horizons["30d"]
                            .rSquared
                    )
                    : null;

            card.noise30 =
                row.horizons?.["30d"]?.available
                    ? Number(
                        row.horizons["30d"]
                            .residualNoisePct
                    )
                    : null;
        }
    }

    return [...grouped.values()]
        .sort(
            (a, b) =>
                b.convictionScore -
                a.convictionScore
        )
        .slice(0, 10);
}

function buildCardHtml(card, index) {
    return `
        <div style="border:1px solid #ddd; border-radius:8px; padding:16px; margin-bottom:20px;">
            <h2 style="margin-top:0;">
                ${index + 1}. ${escapeHtml(card.nomCarte)}
            </h2>

            <p>
                <strong>${escapeHtml(card.edition || "-")}</strong>
                ${card.version ? " • " + escapeHtml(card.version) : ""}
                • ${escapeHtml(card.langue || "-")}
            </p>

            <p>
                <strong>Possédé :</strong> ${escapeHtml(card.ownedLabel || "Non")}
                (${Number(card.quantityOwned || 0)} exemplaire(s), ${escapeHtml(card.ownedStates || "-")})
            </p>

            <h3>🎯 Prix d'achat</h3>
            <p>
                <strong>Prix marché NM :</strong> ${formatEuro(card.nmPrice || card.trendPrice)}<br>
                <strong>Prix max NM :</strong> ${formatEuro(card.nmTargetPrice)}<br>
                <strong>Prix max EX :</strong> ${formatEuro(card.exTargetPrice)}
            </p>

            <h3>📈 Signal récent</h3>
            <p>
                <strong>Momentum :</strong> ${escapeHtml(getMomentumLabel(card))} (${Number(card.momentumQuality || 0)} %)<br>
                <strong>Trend vs Avg30 :</strong> ${formatPercent(card.trendVs30)}<br>
                <strong>Avg1 vs Avg7 :</strong> ${formatPercent(card.avg1Vs7)}
            </p>

            <h3>📊 Décision moteur</h3>
            <p>
                <strong>Probabilité d'achat :</strong> ${Number(card.buyProbability || 0)} %<br>
                <strong>Timing :</strong> ${Number(card.timingScore || 0)} %<br>
                <strong>Potentiel restant :</strong> ${Number(card.remainingPotential || 0)} %<br>
                <strong>Risque :</strong> ×${Number(card.riskMultiplier || 0)}<br>
                <strong>Décision :</strong> ${escapeHtml(card.decision || "-")}
            </p>

            <h3>✅ Points positifs</h3>
            <ul>${listHtml(card.reasons, "✅")}</ul>

            <h3>⚠️ Points de vigilance</h3>
            <ul>${listHtml(card.warnings, "⚠️")}</ul>
        </div>
    `;
}

async function main() {
    const opportunityData =
    loadJson(
        opportunitiesPath,
        {}
    );

const opportunities =
    opportunityData.opportunities || [];

const alerts =
    getEmailOpportunities(
        opportunities
    );

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
    alerts.length === 0 &&
    radarAlerts.length === 0
) {
    console.log(
        "Aucune opportunité ni alerte Radar aujourd'hui, aucun email envoyé."
    );

    return;
}

if (alerts.length > 0) {
    saveAlertsHistory(alerts);
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

    const cardsHtml =
    alerts
        .map(buildCardHtml)
        .join("");

const radarCardsHtml =
    radarAlerts
        .map(buildRadarCardHtml)
        .join("");

    function formatOptionalPercent(value) {
    const number = Number(value);

    if (!Number.isFinite(number)) {
        return "-";
    }

    return formatPercent(number);
}

function buildRadarCardHtml(card, index) {
    return `
        <div style="border:1px solid #ddd; border-radius:8px; padding:16px; margin-bottom:20px;">

            <h2 style="margin-top:0;">
                ${index + 1}. ${escapeHtml(card.nomCarte)}
            </h2>

            <p>
                <strong>${escapeHtml(card.edition || "-")}</strong>
                ${card.version ? " • " + escapeHtml(card.version) : ""}
                • ${escapeHtml(card.langue || "-")}
            </p>

            <p>
                <strong>Possédée :</strong>
                ${card.owned ? "Oui" : "Non"}
            </p>

            <h3>📡 Signal Radar</h3>

            <p>
                <strong>Conviction :</strong>
                ${card.convictionScore} / 100<br>

                <strong>Signal :</strong>
                ${escapeHtml(card.signalLevel)}
            </p>

            <h3>📈 Tendance du modèle</h3>

            <p>
                <strong>14 jours :</strong>
                ${formatOptionalPercent(card.eq14)}<br>

                <strong>21 jours :</strong>
                ${formatOptionalPercent(card.eq21)}<br>

                <strong>30 jours :</strong>
                ${formatOptionalPercent(card.eq30)}
            </p>

            <h3>💶 Estimation actuelle</h3>

            <p>
                <strong>NM :</strong>
                ${card.nmPrice
                    ? formatEuro(card.nmPrice)
                    : "-"}<br>

                <strong>EX :</strong>
                ${card.exPrice
                    ? formatEuro(card.exPrice)
                    : "-"}
            </p>

            <h3>📊 Qualité du signal</h3>

            <p>
                <strong>R² 30 jours :</strong>
                ${
                    Number.isFinite(card.rSquared30)
                        ? card.rSquared30.toFixed(2)
                        : "-"
                }<br>

                <strong>Bruit :</strong>
                ${
                    Number.isFinite(card.noise30)
                        ? `${card.noise30.toFixed(1)} %`
                        : "-"
                }
            </p>

            <p style="font-weight:bold;">
                🔎 Action : vérifier les annonces Cardmarket
            </p>

        </div>
    `;
}

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

    ${
        alerts.length
            ? `
                <hr>

                <h2>🎯 Opportunités d'achat</h2>

                <p>
                    L'ancien moteur d'opportunités a identifié
                    <strong>${alerts.length}</strong>
                    opportunité(s) forte(s).
                </p>

                <p>
                    Les prix maximum NM/EX sont des plafonds
                    théoriques à comparer manuellement aux
                    annonces Cardmarket.
                </p>

                ${cardsHtml}
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
    `📡 ${radarAlerts.length} Radar · ` +
    `🎯 ${alerts.length} opportunité(s) MTG`,
        html
    });

    console.log(
    `Email envoyé : ` +
    `${radarAlerts.length} alerte(s) Radar, ` +
    `${alerts.length} opportunité(s) achat.`
);
}

main().catch(error => {
    console.error(error);
    process.exit(1);
});