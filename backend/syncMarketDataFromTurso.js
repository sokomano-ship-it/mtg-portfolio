const fs = require("fs");
const path = require("path");

const {
    loadMarketObservations
} = require("./tursoMarketDataStore");


const DATA_DIR =
    path.join(
        __dirname,
        "data"
    );


const OBSERVATIONS_PATH =
    path.join(
        DATA_DIR,
        "marketObservations.json"
    );


function writeJson(
    filePath,
    data
) {

    fs.mkdirSync(
        path.dirname(filePath),
        {
            recursive: true
        }
    );

    fs.writeFileSync(
        filePath,
        JSON.stringify(
            data,
            null,
            2
        ),
        "utf8"
    );

}


async function main() {

    console.log(
        "Synchronisation des observations depuis Turso..."
    );


    const observations =
        await loadMarketObservations();


    if (!Array.isArray(observations)) {

        throw new Error(
            "Les observations Turso ne sont pas valides."
        );

    }


    writeJson(
        OBSERVATIONS_PATH,
        observations
    );


    console.log(
        `Observations synchronisées : ${observations.length}`
    );


    console.log(
        "Synchronisation Turso terminée."
    );

}


main().catch(error => {

    console.error(
        "Erreur de synchronisation Turso :",
        error
    );

    process.exit(1);

});