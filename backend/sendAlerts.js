const nodemailer = require("nodemailer");
const fs = require("fs");
const path = require("path");
const { getEmailOpportunities } = require("./opportunityScoring");

const portfolioPath = path.join(__dirname, "..", "frontend", "data", "portfolio.json");
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
    const number = Number(value) || 0;
    return `${number >= 0 ? "+" : ""}${number.toFixed(1)} %`;
}

function todayIsoDate() {
    return new Date().toISOString().slice(0, 10);
}

function alertKey(alert) {
    return [
        alert.date,
        alert.nomCarte,
        alert.edition,
        alert.version,
        alert.langue
    ].join("|");
}

function loadJson(filePath, fallback) {
    if (!fs.existsSync(filePath)) return fallback;

    try {
        return JSON.parse(fs.readFileSync(filePath, "utf8"));
    } catch (error) {
        console.warn(`Impossible de lire ${filePath}, fallback utilisé.`);
        return fallback;
    }
}

function saveAlertsHistory(newAlerts) {
    const previousHistory = loadJson(alertsHistoryPath, []);
    const merged = [...previousHistory];

    const existingKeys = new Set(previousHistory.map(alertKey));

    newAlerts.forEach(alert => {
        const key = alertKey(alert);

        if (!existingKeys.has(key)) {
            merged.push(alert);
            existingKeys.add(key);
        }
    });

    fs.writeFileSync(
        alertsHistoryPath,
        JSON.stringify(merged, null, 2),
        "utf8"
    );

    console.log(`${newAlerts.length} alerte(s) ajoutée(s) à alerts-history.json`);
}

function buildAlertHistoryRows(alerts) {
    const date = todayIsoDate();

    return alerts.map(card => ({
        date,
        nomCarte: card.nomCarte,
        edition: card.edition || "",
        version: card.version || "",
        langue: card.langue || "",
        nmPriceAtAlert: Number(card.nmPrice || 0),
        lowPriceAtAlert: Number(card.lowPrice || 0),
        avg30AtAlert: Number(card.avg30 || 0),
        trendVs30: Number(card.trendVs30 || 0),
        avg1Vs7: Number(card.avg1Vs7 || 0),
        convictionScore: Number(card.convictionScore || 0),
        confidenceScore: Number(card.confidenceScore || 0),
        confidenceLabel: card.confidenceLabel || "",
        recommendation: card.recommendation || "",
        signal: card.signal || "",
        reasons: card.reasons || [],
        warnings: card.warnings || []
    }));
}

async function main() {
    if (!fs.existsSync(portfolioPath)) {
        console.log("portfolio.json introuvable, aucun email envoyé.");
        return;
    }

    const data = JSON.parse(fs.readFileSync(portfolioPath, "utf8"));
    const opportunities = data.opportunities || [];
    const alerts = getEmailOpportunities(opportunities);

    if (alerts.length === 0) {
        console.log("Aucune conviction achat >= 85 avec confiance suffisante, aucun email envoyé.");
        return;
    }

    const alertHistoryRows = buildAlertHistoryRows(alerts);
    saveAlertsHistory(alertHistoryRows);

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

    const cardsHtml = alerts.map((card, index) => {
        const reasonsHtml = (card.reasons || [])
            .map(reason => `<li>✅ ${reason}</li>`)
            .join("");

        const warningsHtml = (card.warnings || [])
            .map(warning => `<li>⚠️ ${warning}</li>`)
            .join("");

        return `
            <h3>${index + 1}. ${card.recommendation} — ${card.nomCarte}</h3>

            <p>
                <strong>Édition :</strong> ${card.edition || "-"} |
                <strong>Version :</strong> ${card.version || "-"} |
                <strong>Langue :</strong> ${card.langue || "-"}
            </p>

            <p>
                <strong>Possédé :</strong> ${card.ownedLabel || "-"} |
                <strong>Exemplaires :</strong> ${card.quantityOwned || 0} |
                <strong>États :</strong> ${card.ownedStates || "-"}
            </p>

            <p>
                <strong>Score conviction :</strong> ${card.convictionScore}/100<br>
                <strong>Indice de confiance :</strong> ${card.confidenceScore}/100 (${card.confidenceLabel})<br>
                <strong>Signal :</strong> ${card.signal || "-"}
            </p>

            <p>
                <strong>Prix NM :</strong> ${formatEuro(card.nmPrice)}<br>
                <strong>Low NM :</strong> ${formatEuro(card.lowPrice)}<br>
                <strong>Avg 30j :</strong> ${formatEuro(card.avg30)}<br>
                <strong>Trend vs 30j :</strong> ${formatPercent(card.trendVs30)}<br>
                <strong>Momentum 1j/7j :</strong> ${formatPercent(card.avg1Vs7)}
            </p>

            <p><strong>Raisons positives :</strong></p>
            <ul>${reasonsHtml || "<li>Aucune raison positive détaillée.</li>"}</ul>

            <p><strong>Points de vigilance :</strong></p>
            <ul>${warningsHtml || "<li>Aucun point de vigilance majeur.</li>"}</ul>

            <hr>
        `;
    }).join("");

    const html = `
        <h2>🎯 Convictions achat MTG</h2>
        <p>
            ${alerts.length} carte(s) seulement ont dépassé le seuil strict :
            conviction ≥ 85 et confiance ≥ 60.
        </p>

        ${cardsHtml}

        <p>Site : https://sokomano-ship-it.github.io/mtg-portfolio/</p>

        <p>
            <em>
                Ce filtre est volontairement très sélectif.
                S’il n’y a pas de vraie conviction, aucun email n’est envoyé.
            </em>
        </p>
    `;

    await transporter.sendMail({
        from: `"MTG Portfolio Alerts" <${SMTP_USER}>`,
        to: ALERT_EMAIL_TO,
        subject: `🎯 ${alerts.length} conviction(s) achat MTG détectée(s)`,
        html
    });

    console.log(`Email envoyé avec ${alerts.length} conviction(s) achat.`);
}

main().catch(error => {
    console.error(error);
    process.exit(1);
});