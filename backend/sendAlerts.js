const nodemailer = require("nodemailer");
const fs = require("fs");
const path = require("path");

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

function isStrongOpportunity(card) {
    return (
        Number(card.score || 0) >= 15 ||
        Number(card.trendVs30 || 0) >= 20 ||
        String(card.signal || "").includes("Forte")
    );
}

async function main() {
    if (!fs.existsSync(dataPath)) {
        console.log("portfolio.json introuvable, aucun email envoyé.");
        return;
    }

    const data = JSON.parse(fs.readFileSync(dataPath, "utf8"));
    const opportunities = data.opportunities || [];

    const alerts = opportunities
        .filter(isStrongOpportunity)
        .sort((a, b) => Number(b.score || 0) - Number(a.score || 0))
        .slice(0, 10);

    if (alerts.length === 0) {
        console.log("Aucune opportunité forte, aucun email envoyé.");
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

    const htmlRows = alerts.map(card => `
        <tr>
            <td><strong>${card.nomCarte}</strong></td>
            <td>${card.edition || "-"}</td>
            <td>${formatEuro(card.trendPrice)}</td>
            <td>${formatEuro(card.avg30)}</td>
            <td>${formatPercent(card.trendVs30)}</td>
            <td>${formatPercent(card.score)}</td>
            <td>${card.signal || "-"}</td>
        </tr>
    `).join("");

    const html = `
        <h2>🔥 Opportunités MTG détectées</h2>
        <p>${alerts.length} opportunité(s) forte(s) détectée(s).</p>
        <table border="1" cellpadding="6" cellspacing="0">
            <thead>
                <tr>
                    <th>Carte</th>
                    <th>Édition</th>
                    <th>Prix NM</th>
                    <th>Avg 30j</th>
                    <th>Trend vs 30j</th>
                    <th>Score</th>
                    <th>Signal</th>
                </tr>
            </thead>
            <tbody>
                ${htmlRows}
            </tbody>
        </table>
        <p>Site : https://sokomano-ship-it.github.io/mtg-portfolio/</p>
    `;

    await transporter.sendMail({
        from: `"MTG Portfolio Alerts" <${SMTP_USER}>`,
        to: ALERT_EMAIL_TO,
        subject: `🔥 ${alerts.length} opportunité(s) MTG détectée(s)`,
        html
    });

    console.log(`Email envoyé avec ${alerts.length} opportunité(s).`);
}

main().catch(error => {
    console.error(error);
    process.exit(1);
});