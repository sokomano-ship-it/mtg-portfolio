const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;

const {
  loadMarketObservations,
  saveMarketObservations,
  loadTrackedMarketCards,
  saveTrackedMarketCards
} = require("../backend/dataStore");

function cors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader(
    "Access-Control-Allow-Headers",
    "Content-Type, X-Admin-Password, x-admin-password, Authorization"
  );
  res.setHeader("Access-Control-Max-Age", "86400");
}

function checkEnv() {
  return Boolean(ADMIN_PASSWORD);
}

function checkAuth(req) {
  return req.headers["x-admin-password"] === ADMIN_PASSWORD;
}

function normalizeCardKey(card) {
  return [
    String(card.nomCarte || "").trim().toLowerCase(),
    String(card.edition || "").trim().toLowerCase(),
    String(card.langue || "").trim().toLowerCase()
  ].join("|");
}

function safeRatio(numerator, denominator) {
  const num = Number(numerator || 0);
  const den = Number(denominator || 0);
  if (!num || !den) return null;
  return Number((num / den).toFixed(6));
}

function cleanObservation(body) {
  const now = new Date();

  const observedMinPrice = Number(body.observedMinPrice || 0);

  const marketSnapshot = {
    trendPrice: Number(body.marketSnapshot?.trendPrice || 0),
    avg30: Number(body.marketSnapshot?.avg30 || 0),
    avg7: Number(body.marketSnapshot?.avg7 || 0),
    avg1: Number(body.marketSnapshot?.avg1 || 0)
  };

  return {
    id: body.id || `${Date.now()}-${Math.random().toString(16).slice(2)}`,
    observationDate: now.toISOString().slice(0, 10),

    nomCarte: String(body.nomCarte || "").trim(),
    edition: String(body.edition || "").trim(),
    langue: String(body.langue || "").trim(),
    condition: String(body.condition || "").trim(),

    observedMinPrice,
    marketSnapshot,

    ratios: {
      vsTrendPrice: safeRatio(observedMinPrice, marketSnapshot.trendPrice),
      vsAvg30: safeRatio(observedMinPrice, marketSnapshot.avg30),
      vsAvg7: safeRatio(observedMinPrice, marketSnapshot.avg7),
      vsAvg1: safeRatio(observedMinPrice, marketSnapshot.avg1)
    },

    source: "Cardmarket",
    createdAt: body.createdAt || now.toISOString(),
    updatedAt: now.toISOString()
  };
}

function cleanTrackedCard(body) {
  const now = new Date();

  return {
    id: body.id || `${Date.now()}-${Math.random().toString(16).slice(2)}`,
    nomCarte: String(body.nomCarte || "").trim(),
    edition: String(body.edition || "").trim(),
    langue: String(body.langue || "").trim(),
    observable: Boolean(body.observable),
    priceMode: body.priceMode === "manual" ? "manual" : "automatic",
    createdAt: body.createdAt || now.toISOString(),
    updatedAt: now.toISOString()
  };
}

module.exports = async function handler(req, res) {
  cors(res);

  if (req.method === "OPTIONS") return res.status(204).end();

  try {
    if (!checkEnv()) {
      return res.status(500).json({ ok: false, error: "Missing environment variables" });
    }

    if (!checkAuth(req)) {
      return res.status(401).json({ ok: false, error: "Unauthorized" });
    }

    if (req.method === "GET") {
  const observationsFile = await loadMarketObservations();
  const trackedCardsFile = await loadTrackedMarketCards();

  return res.status(200).json({
    ok: true,
    observations: Array.isArray(observationsFile.json)
      ? observationsFile.json
      : [],
    trackedCards: Array.isArray(trackedCardsFile.json)
      ? trackedCardsFile.json
      : []
  });
}

    if (req.method === "POST") {
      const body = req.body || {};

      if (body.type === "deleteCardEverywhere") {
  const target = {
    nomCarte: body.nomCarte,
    edition: body.edition,
    langue: body.langue
  };

  const trackedFile = await loadTrackedMarketCards();
const observationsFile = await loadMarketObservations();

  const trackedCards = Array.isArray(trackedFile.json) ? trackedFile.json : [];
  const observations = Array.isArray(observationsFile.json) ? observationsFile.json : [];

  const filteredTracked = trackedCards.filter(card => normalizeCardKey(card) !== normalizeCardKey(target));
  const filteredObservations = observations.filter(obs => normalizeCardKey(obs) !== normalizeCardKey(target));

  await saveTrackedMarketCards(
  filteredTracked,
  trackedFile.sha,
  "Delete tracked card everywhere"
);

  await saveMarketObservations(
  filteredObservations,
  observationsFile.sha,
  "Delete card observations everywhere"
);

  return res.status(200).json({ ok: true });
}

      if (body.type === "addObservation") {
        const file = await loadMarketObservations();
        const observations = Array.isArray(file.json) ? file.json : [];

        observations.push(cleanObservation(body));

        await saveMarketObservations(
  observations,
  file.sha,
  "Add market observation"
);

        return res.status(200).json({ ok: true });
      }
      if (body.type === "addConditionObservations") {
  const file = await loadMarketObservations();
  const observations = Array.isArray(file.json) ? file.json : [];

  const entries = Array.isArray(body.entries) ? body.entries : [];

  entries.forEach(entry => {
    observations.push(cleanObservation({
      ...body,
      condition: entry.condition,
      observedMinPrice: entry.observedMinPrice
    }));
  });

  await saveMarketObservations(
  observations,
  file.sha,
  "Add condition market observations"
);

  return res.status(200).json({ ok: true });
}

      if (body.type === "deleteObservation") {
        const file = await loadMarketObservations();
        const observations = Array.isArray(file.json) ? file.json : [];

        const filtered = observations.filter(obs => obs.id !== body.id);

        await saveMarketObservations(
  filtered,
  file.sha,
  "Delete market observation"
);

        return res.status(200).json({ ok: true });
      }

      if (body.type === "deleteObservations") {
        const ids = Array.isArray(body.ids) ? body.ids : [];

        const file = await loadMarketObservations();
        const observations = Array.isArray(file.json) ? file.json : [];

        const filtered = observations.filter(obs => !ids.includes(obs.id));

        await saveMarketObservations(
  filtered,
  file.sha,
  "Delete market observations"
);

        return res.status(200).json({ ok: true });
      }

      if (body.type === "saveTrackedCard") {
        const file = await loadTrackedMarketCards();
        const trackedCards = Array.isArray(file.json) ? file.json : [];
        const incoming = cleanTrackedCard(body);
        const incomingKey = normalizeCardKey(incoming);

        const filtered = trackedCards.filter(card => normalizeCardKey(card) !== incomingKey);
        filtered.push(incoming);

        await saveTrackedMarketCards(
  filtered,
  file.sha,
  "Update tracked market card"
);

        return res.status(200).json({ ok: true });
      }

      if (body.type === "deleteTrackedCard") {
        const file = await loadTrackedMarketCards();
        const trackedCards = Array.isArray(file.json) ? file.json : [];

        const filtered = trackedCards.filter(card => card.id !== body.id);

        await saveTrackedMarketCards(
  filtered,
  file.sha,
  "Delete tracked market card"
);

        return res.status(200).json({ ok: true });
      }

      return res.status(400).json({ ok: false, error: "Unknown action type" });
    }

    return res.status(405).json({ ok: false, error: "Method not allowed" });
  } catch (error) {
    return res.status(500).json({ ok: false, error: error.message });
  }
};