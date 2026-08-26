const path = require("path");
const fs = require("fs");

const RADAR_HISTORY_START_DATE =
    "2026-08-22";

module.exports = function handler(req, res) {

    try {

        const filePath = path.join(
            process.cwd(),
            "frontend",
            "data",
            "radar.json"
        );

        const raw =
            fs.readFileSync(
                filePath,
                "utf8"
            );

        const data =
            JSON.parse(raw);


        /*
         * La coupure historique doit être
         * appliquée lors de la génération
         * de radar.json.
         *
         * Ici on expose simplement
         * l'information au frontend.
         */
        res.status(200).json({
            ...data,

            historyStartDate:
                data.historyStartDate ||
                RADAR_HISTORY_START_DATE
        });

    } catch (error) {

        console.error(error);

        res.status(500).json({
            error:
                "Impossible de charger radar",

            message:
                error.message
        });
    }
};