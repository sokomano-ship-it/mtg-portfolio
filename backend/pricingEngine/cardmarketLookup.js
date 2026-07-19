function normalize(value) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\(v\.\d+\)/gi, "")
    .replace(/[^a-z0-9]/g, "")
    .trim();
}

function cleanCardName(name) {
  return String(name || "")
    .replace(/\((V\.\d+)\)/i, "")
    .trim();
}

function editionAliases(edition) {
  const value = String(edition || "").trim();

  const aliases = {
    "Arabian Nights": [
      "Arabian Nights"
    ],

    Antiquities: [
      "Antiquities"
    ],

    Legends: [
      "Legends",
      "Legend"
    ],

    Legend: [
      "Legends",
      "Legend"
    ],

    "Legends Italian": [
      "Legends",
      "Legend",
      "Legends Italian",
      "Rinascimento"
    ],

    "The Dark": [
      "The Dark"
    ],

    "Fallen Empires": [
      "Fallen Empires"
    ],

    Chronicles: [
      "Chronicles"
    ],

    Renaissance: [
      "Renaissance"
    ],

    "Fourth Edition": [
      "Fourth Edition",
      "4th Edition"
    ],

    "4th Edition": [
      "Fourth Edition",
      "4th Edition"
    ],

    Unlimited: [
      "Unlimited",
      "Unlimited Edition"
    ],

    "Unlimited Edition": [
      "Unlimited",
      "Unlimited Edition"
    ],

    Revised: [
      "Revised",
      "Revised Edition",
      "3rd Edition",
      "Third Edition"
    ],

    "Revised Edition": [
      "Revised",
      "Revised Edition",
      "3rd Edition",
      "Third Edition"
    ],

    "Foreign White Bordered": [
      "Revised",
      "Revised Edition",
      "3rd Edition",
      "Third Edition",
      "Foreign White Bordered",
      "Foreign White Border"
    ],

    "Foreign White Border": [
      "Revised",
      "Revised Edition",
      "3rd Edition",
      "Third Edition",
      "Foreign White Bordered",
      "Foreign White Border"
    ],

    FWB: [
      "Revised",
      "Revised Edition",
      "3rd Edition",
      "Third Edition",
      "Foreign White Bordered",
      "Foreign White Border"
    ],

    "Foreign Black Bordered": [
      "Foreign Black Bordered",
      "Foreign Black Border"
    ],

    "Foreign Black Border": [
      "Foreign Black Bordered",
      "Foreign Black Border"
    ],

    FBB: [
      "Foreign Black Bordered",
      "Foreign Black Border"
    ]
  };

  return aliases[value] || [value];
}

function isForeignWhiteBordered(edition) {
  const value = normalize(edition);

  return (
    value === "foreignwhitebordered" ||
    value === "foreignwhiteborder" ||
    value === "fwb"
  );
}

function isLegendsItalian(card) {
  const edition = normalize(card.edition);
  const langue = normalize(card.langue);

  return (
    edition === "legendsitalian" ||
    (edition === "legends" && langue === "italian")
  );
}

function getPriceName(price) {
  return (
    price.enName ||
    price.name ||
    price.productName ||
    price.nameProduct ||
    price.locName ||
    ""
  );
}

function getExpansionName(price) {
  return (
    price.expansionName ||
    price.expansion ||
    price.categoryName ||
    price.nameExpansion ||
    ""
  );
}

function getProductId(price) {
  if (!price || typeof price !== "object") {
    return 0;
  }

  return Number(
    price.idProduct ||
    price.productId ||
    price.id ||
    0
  );
}

function getPriceValue(price, key) {
  if (price?.[key] !== undefined) {
    return price[key];
  }

  if (
    price?.priceGuide &&
    price.priceGuide[key] !== undefined
  ) {
    return price.priceGuide[key];
  }

  const upperKey = String(key || "").toUpperCase();

  if (
    price?.priceGuide &&
    price.priceGuide[upperKey] !== undefined
  ) {
    return price.priceGuide[upperKey];
  }

  return null;
}

function extractPrice(price) {
  if (!price) {
    return {
      trend: null,
      low: null,
      avg: null,
      avg1: null,
      avg7: null,
      avg30: null
    };
  }

  return {
    trend:
      getPriceValue(price, "trend") ??
      getPriceValue(price, "TREND"),

    low:
      getPriceValue(price, "low") ??
      getPriceValue(price, "LOW"),

    avg:
      getPriceValue(price, "avg") ??
      getPriceValue(price, "AVG"),

    avg1:
      getPriceValue(price, "avg1") ??
      getPriceValue(price, "AVG1"),

    avg7:
      getPriceValue(price, "avg7") ??
      getPriceValue(price, "AVG7"),

    avg30:
      getPriceValue(price, "avg30") ??
      getPriceValue(price, "AVG30")
  };
}

function buildIndexes(priceGuides) {
  const rows = Array.isArray(priceGuides)
    ? priceGuides
    : [];

  const byProductId = new Map();
  const byName = new Map();

  rows.forEach(price => {
    const idProduct = getProductId(price);
    const name = normalize(getPriceName(price));

    if (idProduct) {
      byProductId.set(idProduct, price);
    }

    if (!name) {
      return;
    }

    if (!byName.has(name)) {
      byName.set(name, []);
    }

    byName.get(name).push(price);
  });

  return {
    byProductId,
    byName,
    all: rows
  };
}

function findCandidatesByName(card, indexes) {
  const names = [
    card.nomBase,
    card.nomCarte,
    cleanCardName(card.nomCarte)
  ]
    .filter(Boolean)
    .map(normalize);

  const uniqueNames = [...new Set(names)];

  let candidates = [];

  uniqueNames.forEach(name => {
    const exact = indexes.byName.get(name) || [];
    candidates = candidates.concat(exact);
  });

  if (candidates.length > 0) {
    return candidates;
  }

  const mainName = normalize(
    cleanCardName(card.nomBase || card.nomCarte)
  );

  if (!mainName) {
    return [];
  }

  return indexes.all.filter(price => {
    const priceName = normalize(getPriceName(price));

    return (
      priceName === mainName ||
      priceName.includes(mainName) ||
      mainName.includes(priceName)
    );
  });
}

function acceptedExpansionIds(card) {
  const edition = normalize(card.edition);

  const expansionIds = {
    revised: [6],
    revisededition: [6],

    foreignblackbordered: [57],
    foreignblackborder: [57],
    fbb: [57],

    foreignwhitebordered: [73],
    foreignwhiteborder: [73],
    fwb: [73]
  };

  return expansionIds[edition] || [];
}


function findEditionMatch(card, candidates) {
  const acceptedIds = acceptedExpansionIds(card);

  if (acceptedIds.length > 0) {
    const expansionMatch = candidates.find(price =>
      acceptedIds.includes(Number(price.idExpansion))
    );

    if (expansionMatch) {
      return expansionMatch;
    }
  }

  const acceptedEditions = editionAliases(card.edition)
    .map(normalize);

  const exactEditionMatch = candidates.find(price =>
    acceptedEditions.includes(
      normalize(getExpansionName(price))
    )
  );

  if (exactEditionMatch) {
    return exactEditionMatch;
  }

  if (isForeignWhiteBordered(card.edition)) {
    const revisedFallback = candidates.find(price => {
      const expansion = normalize(
        getExpansionName(price)
      );

      return (
        expansion.includes("revised") ||
        expansion.includes("3rdedition") ||
        expansion.includes("thirdedition")
      );
    });

    if (revisedFallback) {
      return revisedFallback;
    }
  }

  if (isLegendsItalian(card)) {
    const legendsFallback = candidates.find(price => {
      const expansion = normalize(
        getExpansionName(price)
      );

      return (
        expansion === "legends" ||
        expansion === "legend"
      );
    });

    if (legendsFallback) {
      return legendsFallback;
    }
  }

  return null;
}

function findPriceForCard(card, indexes) {
  if (!card || !indexes) {
    return null;
  }

  if (card.cardmarketId) {
    const directPrice = indexes.byProductId.get(
      Number(card.cardmarketId)
    );

    if (directPrice) {
      return directPrice;
    }
  }

  const candidates = findCandidatesByName(
    card,
    indexes
  );

  if (!candidates.length) {
    return null;
  }

  return findEditionMatch(card, candidates);
}

module.exports = {
  normalize,
  cleanCardName,
  editionAliases,
  acceptedExpansionIds,
  getPriceName,
  getExpansionName,
  getProductId,
  extractPrice,
  buildIndexes,
  findCandidatesByName,
  findEditionMatch,
  findPriceForCard
};