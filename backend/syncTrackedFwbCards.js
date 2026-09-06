const fs = require("fs");
const path = require("path");
const db = require("./database");

const TRACKED_PATH = path.join(
  __dirname,
  "data",
  "trackedMarketCards.json"
);

const SPECIAL_RULES = [
  {
    edition: "Foreign White Bordered",
    languages: ["French", "German", "Italian"],
    pricingModel: "fwb_revised_ratio",

    referenceEdition: "Revised",
    referenceLanguage: "English"
  },

  {
    edition: "Legends",
    languages: ["Italian"],
    pricingModel: "legends_italian_ratio"
  }
];

function normalize(v) {
  return String(v || "")
    .trim()
    .toLowerCase();
}

function key(card) {
  return [
    normalize(card.nomCarte),
    normalize(card.edition),
    normalize(card.langue)
  ].join("|");
}

function readJson(file, fallback) {
  if (!fs.existsSync(file)) return fallback;

  return JSON.parse(
    fs.readFileSync(file, "utf8")
  );
}

function isSpecial(card) {
  return SPECIAL_RULES.find(rule =>
    normalize(card.edition) ===
      normalize(rule.edition) &&

    rule.languages
      .map(normalize)
      .includes(
        normalize(card.langue)
      )
  );
}

function createId(prefix) {
  return (
    `${prefix}-${Date.now()}-` +
    Math.random()
      .toString(16)
      .slice(2)
  );
}

db.all(
  "SELECT nomCarte, edition, langue FROM cards",
  [],
  (err, rows) => {

    if (err) {
      console.error(err.message);
      db.close();
      process.exit(1);
    }

    const tracked =
      readJson(TRACKED_PATH, []);

    const existing =
      new Set(
        tracked.map(key)
      );

    let specialAdded = 0;
    let referenceAdded = 0;

    rows.forEach(row => {

      const card = {
        nomCarte:
          String(
            row.nomCarte || ""
          ).trim(),

        edition:
          String(
            row.edition || ""
          ).trim(),

        langue:
          String(
            row.langue || ""
          ).trim()
      };

      const rule =
        isSpecial(card);

      if (!rule) {
        return;
      }

      /*
       * 1. Carte spéciale elle-même
       *
       * Exemple :
       * Wheel of Fortune
       * Foreign White Bordered
       * French
       */
      const cardKey =
        key(card);

      if (!existing.has(cardKey)) {

        tracked.push({
          id:
            createId("special"),

          nomCarte:
            card.nomCarte,

          edition:
            card.edition,

          langue:
            card.langue,

          observable:
            true,

          priceMode:
            "manual",

          pricingModel:
            rule.pricingModel,

          createdAt:
            new Date().toISOString(),

          updatedAt:
            new Date().toISOString()
        });

        existing.add(cardKey);
        specialAdded += 1;
      }

      /*
       * 2. Référence marché automatique.
       *
       * Pour les FWB FR/DE/IT :
       *
       *   FWB FR
       *      ↓ évolution
       *   Revised English
       *
       * Cette carte n'est PAS manuelle :
       * resolveTrackedMarketCards.js pourra donc
       * récupérer son Cardmarket ID et son prix.
       */
      if (
        rule.referenceEdition &&
        rule.referenceLanguage
      ) {

        const referenceCard = {
          nomCarte:
            card.nomCarte,

          edition:
            rule.referenceEdition,

          langue:
            rule.referenceLanguage
        };

        const referenceKey =
          key(referenceCard);

        if (
          !existing.has(
            referenceKey
          )
        ) {

          const now =
            new Date().toISOString();

          tracked.push({
            id:
              createId("reference"),

            nomCarte:
              referenceCard.nomCarte,

            edition:
              referenceCard.edition,

            langue:
              referenceCard.langue,

            observable:
              true,

            referenceFor:
              rule.pricingModel,

            createdAt:
              now,

            updatedAt:
              now
          });

          existing.add(
            referenceKey
          );

          referenceAdded += 1;
        }
      }
    });

    fs.writeFileSync(
      TRACKED_PATH,
      JSON.stringify(
        tracked,
        null,
        2
      )
    );

    console.log(
      `Cartes spéciales ajoutées : ${specialAdded}`
    );

    console.log(
      `Références marché ajoutées : ${referenceAdded}`
    );

    console.log(
      `Total cartes suivies : ${tracked.length}`
    );

    db.close();
  }
);