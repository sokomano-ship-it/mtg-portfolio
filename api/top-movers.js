const path = require("path");
const fs = require("fs");

module.exports = function handler(req, res) {
    try {
        const filePath = path.join(
            process.cwd(),
            "frontend",
            "data",
            "top-movers.json"
        );

        const raw = fs.readFileSync(filePath, "utf8");
        const data = JSON.parse(raw);

        res.status(200).json(data);
    } catch (error) {
        console.error(error);

        res.status(500).json({
            error: "Impossible de charger top-movers",
            message: error.message
        });
    }
};