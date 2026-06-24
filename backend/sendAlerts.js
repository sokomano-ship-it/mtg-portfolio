const nodemailer = require("nodemailer");
const fs = require("fs");
const path = require("path");
const { getEmailOpportunities } = require("./opportunityScoring");

const dataPath = path.join(__dirname, "..", "frontend", "data", "portfolio.json");

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

async function main() {
    if (!fs.existsSync(dataPath)) {
        console.log("portfolio.json introuvable, aucun email envoyé.");
        return;
    }

    const data = JSON.parse(fs.readFileSync(dataPath, "utf8"));
    const opportunities = data.opportunities || [];
    const alerts = getEmailOpportunities(opportunities);

    if (alerts.length === 0) {
        console.log("Aucune conviction achat >= 85, aucun email envoyé.");
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

    const cardsHtml = alerts.map((card, index) => `
        <h3>${index + 1}. ${card.recommendation} — ${card.nomCarte}</h3>
        <p>
            <strong>Édition :</strong> ${card.edition || "-"} |
            <strong>Version :</strong> ${card.version || "-"} |
            <strong>Langue :</strong> ${card.langue || "-"}
        </p>
        <p>
            <strong>Score conviction :</strong> ${card.convictionScore}/100<br>
            <strong>Prix NM :</strong> ${formatEuro(card.nmPrice)}<br>
            <strong>Low NM :</strong> ${formatEuro(card.lowPrice)}<br>
            <strong>Avg 30j :</strong> ${formatEuro(card.avg30)}<br>
            <strong>Trend vs 30j :</strong> ${formatPercent(card.trendVs30)}<br>
            <strong>Momentum 1j/7j :</strong> ${formatPercent(card.avg1Vs7)}
        </p>
        <p><strong>Pourquoi :</strong></p>
        <ul>
            ${(card.reasons || []).map(reason => `<li>${reason}</li>`).join("")}
        </ul>
        <hr>
    `).join("");

    const html = `
        <h2>🎯 Convictions achat MTG</h2>
        <p>${alerts.length} carte(s) seulement ont dépassé le seuil strict de 85/100.</p>
        ${cardsHtml}
        <p>Site : https://sokomano-ship-it.github.io/mtg-portfolio/</p>
        <p><em>Rappel : ce filtre est volontairement très sélectif. S’il n’y a pas de vraie conviction, aucun email n’est envoyé.</em></p>
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