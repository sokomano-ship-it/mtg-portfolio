const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;

const {
  loadMarketObservations,
  loadTrackedMarketCards,
  addMarketObservation,
  deleteMarketObservation,
  deleteMarketObservations,
  deleteCardObservations,
  saveTrackedCard: saveTrackedCardToTurso,
  deleteTrackedCard: deleteTrackedCardFromTurso,
  deleteTrackedCardByIdentity
} = require("../backend/tursoMarketDataStore");

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
  return Boolean(
    ADMIN_PASSWORD &&
    process.env.TURSO_DATABASE_URL &&
    process.env.TURSO_AUTH_TOKEN
  );
}

function checkAuth(req) {
  return req.headers["x-admin-password"] === ADMIN_PASSWORD;
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
  const observations = await loadMarketObservations();
const trackedCards = await loadTrackedMarketCards();

return res.status(200).json({
  ok: true,
  observations,
  trackedCards
});
}

    if (req.method === "POST") {
      const body = req.body || {};

      if (body.type === "deleteCardEverywhere") {
  const target = {
    nomCarte: String(body.nomCarte || "").trim(),
    edition: String(body.edition || "").trim(),
    langue: String(body.langue || "").trim()
  };

  await deleteTrackedCardByIdentity(target);
  await deleteCardObservations(target);

  return res.status(200).json({ ok: true });
}

      if (body.type === "addObservation") {
  const observation = cleanObservation(body);

  await addMarketObservation(observation);

  return res.status(200).json({
    ok: true,
    observation
  });
}
      if (body.type === "addConditionObservations") {
  const entries = Array.isArray(body.entries)
    ? body.entries
    : [];

  const observations = entries.map(entry =>
    cleanObservation({
      ...body,
      condition: entry.condition,
      observedMinPrice: entry.observedMinPrice
    })
  );

  for (const observation of observations) {
    await addMarketObservation(observation);
  }

  return res.status(200).json({
    ok: true,
    count: observations.length
  });
}

      if (body.type === "deleteObservation") {
  await deleteMarketObservation(body.id);

  return res.status(200).json({ ok: true });
}

      if (body.type === "deleteObservations") {
  const ids = Array.isArray(body.ids)
    ? body.ids
    : [];

  await deleteMarketObservations(ids);

  return res.status(200).json({
    ok: true,
    count: ids.length
  });
}

      if (body.type === "saveTrackedCard") {
  const trackedCard = cleanTrackedCard(body);

  await saveTrackedCardToTurso(trackedCard);

  return res.status(200).json({
    ok: true,
    trackedCard
  });
}

      if (body.type === "deleteTrackedCard") {
  await deleteTrackedCardFromTurso(body.id);

  return res.status(200).json({ ok: true });
}

      return res.status(400).json({ ok: false, error: "Unknown action type" });
    }

    return res.status(405).json({ ok: false, error: "Method not allowed" });
  } catch (error) {
    return res.status(500).json({ ok: false, error: error.message });
  }
};