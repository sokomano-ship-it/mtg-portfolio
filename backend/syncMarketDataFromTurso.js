const fs = require("fs");
const path = require("path");

const {
    loadMarketObservations,
    loadTrackedMarketCards
} = require("./tursoMarketDataStore");


const DATA_DIR =
    path.join(
        __dirname,
        "data"
    );


const TRACKED_PATH = path.join(DATA_DIR, "trackedMarketCards.json");

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


    const tracked = await loadTrackedMarketCards();
    if (!Array.isArray(tracked)) throw new Error("Cartes Administration Turso invalides");
    // Source de vérité : Administration (Turso), sans ajout de carte en dur.
    writeJson(TRACKED_PATH, tracked);
    console.log(`Cartes suivies synchronisées depuis Administration : ${tracked.length}`);

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