const fs = require("fs");
const path = require("path");

const PRICE_GUIDE_URL =
  "https://downloads.s3.cardmarket.com/productCatalog/priceGuide/price_guide_1.json";

const ROOT = path.join(__dirname, "..");
const PORTFOLIO_PATH = path.join(ROOT, "frontend", "data", "portfolio.json");
const TRACKED_PATH = path.join(ROOT, "backend", "data", "trackedMarketCards.json");
const MANUAL_PATH = path.join(ROOT, "backend", "data", "manualPrices.json");
const OUT_PATH = path.join(ROOT, "frontend", "data", "market-reference.json");

function readJson(file, fallback) {
  if (!fs.existsSync(file)) return fallback;
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function normalize(value) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[’']/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function getName(x) {
  return x.nomCarte || x.name || x.productName || "";
}

function getEdition(x) {
  return x.edition || x.setName || x.expansionName || "";
}

function getLangue(x) {
  return x.langue || x.language || "";
}

function key(card) {
  return `${normalize(getName(card))}|${normalize(getEdition(card))}|${normalize(getLangue(card))}`;
}

function priceKey(card) {
  return `${normalize(getName(card))}|${normalize(getEdition(card))}`;
}

function getProductName(price) {
  return price.productName || price.name || price.enName || "";
}

function getExpansionName(price) {
  return price.expansionName || price.expansion || price.setName || "";
}

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function extractPrices(price) {
  return {
    trendPrice: num(price.trendPrice ?? price.priceTrend ?? price.trend ?? price.eur),
    avg30: num(price.avg30 ?? price.avg30Days ?? price.avg30Price),
    avg7: num(price.avg7 ?? price.avg7Days ?? price.avg7Price),
    avg1: num(price.avg1 ?? price.avg1Day ?? price.avg1Price)
  };
}

function normalizePortfolio(raw) {
  const arr = Array.isArray(raw) ? raw : (raw.cards || raw.portfolio || []);

  return arr.map(c => ({
    nomCarte: getName(c),
    edition: getEdition(c),
    langue: getLangue(c),
    sourceType: "portfolio",
    trendPrice: num(c.trendPrice ?? c.nmPrice ?? c.priceTrend),
    avg30: num(c.avg30),
    avg7: num(c.avg7),
    avg1: num(c.avg1)
  }));
}

function mergeCards(...lists) {
  const map = new Map();

  lists.flat().forEach(card => {
    const k = key(card);
    if (!k.replaceAll("|", "")) return;
    if (!map.has(k)) map.set(k, card);
  });

  return [...map.values()];
}

function editionToScryfallSet(edition) {
  const e = normalize(edition);

  const map = {
    "arabian nights": "arn",
    "antiquities": "atq",
    "legends": "leg",
    "the dark": "drk",
    "fallen empires": "fem",
    "fourth edition": "4ed",
    "revised": "3ed",
    "foreign white bordered": "3ed",
    "foreign black bordered": "3ed",
    "renaissance": "ren",
    "chronicles": "chr",
    "stronghold": "sth",
    "mirage": "mir",
    "visions": "vis",
    "weatherlight": "wth",
    "tempest": "tmp",
    "exodus": "exo",
    "urzas saga": "usg",
    "urzas legacy": "ulg",
    "urzas destiny": "uds"
  };

  return map[e] || "";
}

async function fetchScryfallPrice(card) {
  const name = encodeURIComponent(getName(card));
  const set = editionToScryfallSet(getEdition(card));

  const url = set
    ? `https://api.scryfall.com/cards/named?exact=${name}&set=${set}`
    : `https://api.scryfall.com/cards/named?exact=${name}`;

  const response = await fetch(url, {
    headers: {
      "User-Agent": "mtg-portfolio/1.0"
    }
  });

  if (!response.ok) return null;

  const data = await response.json();

  const eur = num(data.prices?.eur);
  if (!eur) return null;

  return {
    trendPrice: eur,
    avg30: eur,
    avg7: eur,
    avg1: eur,
    priceSource: "scryfall-eur"
  };
}

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function main() {
  console.log("Construction market-reference.json...");

  const portfolioRaw = readJson(PORTFOLIO_PATH, []);
  const tracked = readJson(TRACKED_PATH, []);
  const manual = readJson(MANUAL_PATH, []);

  const portfolio = normalizePortfolio(portfolioRaw);

  const trackedCards = tracked.map(c => ({
    nomCarte: c.nomCarte,
    edition: c.edition,
    langue: c.langue || "English",
    sourceType: "tracked"
  }));

  const manualCards = manual.map(c => ({
    nomCarte: c.nomCarte,
    edition: c.edition,
    langue: c.langue || "English",
    sourceType: "manual",
    trendPrice: num(c.trendPrice),
    avg30: num(c.avg30),
    avg7: num(c.avg7),
    avg1: num(c.avg1)
  }));

  const cards = mergeCards(portfolio, trackedCards, manualCards);

  console.log(`${cards.length} carte(s) à référencer.`);

  const response = await fetch(PRICE_GUIDE_URL);
  if (!response.ok) {
    throw new Error(`Price guide download failed: ${response.status}`);
  }

  const json = await response.json();
  const prices = Array.isArray(json) ? json : (json.products || json.priceGuides || []);

  const priceMap = new Map();

  prices.forEach(price => {
    const k = `${normalize(getProductName(price))}|${normalize(getExpansionName(price))}`;
    if (!priceMap.has(k)) priceMap.set(k, price);
  });

  const output = [];

  for (const card of cards) {
    const manualMatch = manualCards.find(m => key(m) === key(card));

    if (
      manualMatch &&
      (manualMatch.trendPrice || manualMatch.avg30 || manualMatch.avg7 || manualMatch.avg1)
    ) {
      output.push({
        ...card,
        ...extractPrices(manualMatch),
        priceSource: "manual"
      });
      continue;
    }

    const portfolioMatch = portfolio.find(p => key(p) === key(card));

    if (
      portfolioMatch &&
      (portfolioMatch.trendPrice || portfolioMatch.avg30 || portfolioMatch.avg7 || portfolioMatch.avg1)
    ) {
      output.push({
        ...card,
        ...extractPrices(portfolioMatch),
        priceSource: "portfolio"
      });
      continue;
    }

    let price = priceMap.get(priceKey(card));

    if (!price) {
      const candidates = prices.filter(p =>
        normalize(getProductName(p)) === normalize(getName(card))
      );

      if (candidates.length === 1) {
        price = candidates[0];
      } else if (candidates.length > 1) {
        price = candidates.find(p =>
          normalize(getExpansionName(p)).includes(normalize(getEdition(card))) ||
          normalize(getEdition(card)).includes(normalize(getExpansionName(p)))
        );
      }
    }

    if (price) {
      output.push({
        ...card,
        ...extractPrices(price),
        priceSource: "cardmarket-price-guide"
      });
      continue;
    }

    const scryfallPrice = await fetchScryfallPrice(card);
    await sleep(80);

    if (scryfallPrice) {
      output.push({
        ...card,
        ...scryfallPrice
      });
      continue;
    }

    output.push({
      ...card,
      trendPrice: 0,
      avg30: 0,
      avg7: 0,
      avg1: 0,
      priceSource: "missing"
    });
  }

  fs.mkdirSync(path.dirname(OUT_PATH), { recursive: true });
  fs.writeFileSync(OUT_PATH, JSON.stringify(output, null, 2));

  console.log(`market-reference.json généré : ${output.length} ligne(s).`);
  console.log(`Trouvés : ${output.filter(x => x.priceSource !== "missing").length}`);
  console.log(`Manquants : ${output.filter(x => x.priceSource === "missing").length}`);

  const missing = output.filter(x => x.priceSource === "missing");
  if (missing.length) {
    console.log("Manquants :");
    missing.forEach(x => console.log(`- ${x.nomCarte} | ${x.edition} | ${x.langue}`));
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});