const cron = require("node-cron");
const { execFile } = require("child_process");
const path = require("path");

let isRunning = false;

function runNodeScript(scriptName) {
    return new Promise((resolve, reject) => {
        const scriptPath = path.join(__dirname, scriptName);

        const child = execFile(
            process.execPath,
            [scriptPath],
            {
                cwd: path.join(__dirname, ".."),
                env: process.env
            },
            (error, stdout, stderr) => {
                if (stdout) console.log(stdout);
                if (stderr) console.error(stderr);

                if (error) reject(error);
                else resolve();
            }
        );

        child.stdout?.pipe(process.stdout);
        child.stderr?.pipe(process.stderr);
    });
}

async function runDailyUpdate() {
    if (isRunning) {
        console.log("Mise à jour déjà en cours, ignorée.");
        return;
    }

    isRunning = true;

    try {
        console.log("Début mise à jour quotidienne MTG...");

        await runNodeScript("updateCardmarketFromPriceGuide.js");
        await runNodeScript("updatePortfolioValue.js");

        console.log("Mise à jour quotidienne terminée.");
    } catch (error) {
        console.error("Erreur mise à jour quotidienne :", error.message);
    } finally {
        isRunning = false;
    }
}

function startScheduler() {
    cron.schedule(
        "0 7 * * *",
        runDailyUpdate,
        {
            timezone: "Europe/Paris"
        }
    );

    console.log("Scheduler actif : mise à jour quotidienne à 07:00 Europe/Paris");
}

module.exports = {
    startScheduler,
    runDailyUpdate
};