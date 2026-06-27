const OWNER = process.env.GITHUB_OWNER;
const REPO = process.env.GITHUB_REPO;
const TOKEN = process.env.GITHUB_TOKEN;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
const BRANCH = process.env.GITHUB_BRANCH || "main";

const FILES = {
  manualPrices: "backend/data/manualPrices.json",
  observations: "backend/data/marketObservations.json",
  trackedCards: "backend/data/trackedMarketCards.json"
};

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
  return OWNER && REPO && TOKEN && ADMIN_PASSWORD;
}

function checkAuth(req) {
  return req.headers["x-admin-password"] === ADMIN_PASSWORD;
}

function githubHeaders() {
  return {
    Authorization: `Bearer ${TOKEN}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "Content-Type": "application/json"
  };
}

function githubUrl(filePath) {
  return `https://api.github.com/repos/${OWNER}/${REPO}/contents/${encodeURIComponent(filePath).replace(/%2F/g, "/")}`;
}

async function getJsonFile(filePath) {
  const response = await fetch(`${githubUrl(filePath)}?ref=${BRANCH}`, {
    headers: githubHeaders()
  });

  if (response.status === 404) {
    return { json: [], sha: null };
  }

  if (!response.ok) {
    throw new Error(`GitHub GET ${filePath} failed: ${response.status} ${await response.text()}`);
  }

  const data = await response.json();
  const content = Buffer.from(data.content, "base64").toString("utf8");

  return {
    json: JSON.parse(content),
    sha: data.sha
  };
}

async function putJsonFile(filePath, json, sha, message) {
  const body = {
    message,
    branch: BRANCH,
    content: Buffer.from(JSON.stringify(json, null, 2)).toString("base64")
  };

  if (sha) body.sha = sha;

  const response = await fetch(githubUrl(filePath), {
    method: "PUT",
    headers: githubHeaders(),
    body: JSON.stringify(body)
  });

  if (!response.ok) {
    throw new Error(`GitHub PUT ${filePath} failed: ${response.status} ${await response.text()}`);
  }

  return response.json();
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
    createdAt: body.createdAt || now.toISOString(),
    updatedAt: now.toISOString()
  };
}

module.exports = async function handler(req, res) {
  cors(res);

  if (req.method === "OPTIONS") {
  return res.status(204).end();
}

  try {
    if (!checkEnv()) {
      return res.status(500).json({ ok: false, error: "Missing environment variables" });
    }

    if (!checkAuth(req)) {
      return res.status(401).json({ ok: false, error: "Unauthorized" });
    }

    if (req.method === "GET") {
      const manual = await getJsonFile(FILES.manualPrices);
      const observations = await getJsonFile(FILES.observations);
      const trackedCards = await getJsonFile(FILES.trackedCards);

      return res.status(200).json({
        ok: true,
        manualPrices: manual.json,
        observations: observations.json,
        trackedCards: trackedCards.json
      });
    }

    if (req.method === "POST") {
      const body = req.body || {};

      if (body.type === "saveManualPrices") {
        const file = await getJsonFile(FILES.manualPrices);

        await putJsonFile(
          FILES.manualPrices,
          Array.isArray(body.data) ? body.data : [],
          file.sha,
          "Update manual special prices"
        );

        return res.status(200).json({ ok: true });
      }

      if (body.type === "addObservation") {
        const file = await getJsonFile(FILES.observations);
        const observations = Array.isArray(file.json) ? file.json : [];

        observations.push(cleanObservation(body));

        await putJsonFile(
          FILES.observations,
          observations,
          file.sha,
          "Add market observation"
        );

        return res.status(200).json({ ok: true });
      }

      if (body.type === "deleteObservation") {
        const file = await getJsonFile(FILES.observations);
        const observations = Array.isArray(file.json) ? file.json : [];

        const filtered = observations.filter(obs => obs.id !== body.id);

        await putJsonFile(
          FILES.observations,
          filtered,
          file.sha,
          "Delete market observation"
        );

        return res.status(200).json({ ok: true });
      }

      if (body.type === "saveTrackedCard") {
        const file = await getJsonFile(FILES.trackedCards);
        const trackedCards = Array.isArray(file.json) ? file.json : [];
        const incoming = cleanTrackedCard(body);
        const incomingKey = normalizeCardKey(incoming);

        const filtered = trackedCards.filter(card => normalizeCardKey(card) !== incomingKey);
        filtered.push(incoming);

        await putJsonFile(
          FILES.trackedCards,
          filtered,
          file.sha,
          "Update tracked market card"
        );

        return res.status(200).json({ ok: true });
      }

      if (body.type === "deleteTrackedCard") {
        const file = await getJsonFile(FILES.trackedCards);
        const trackedCards = Array.isArray(file.json) ? file.json : [];

        const filtered = trackedCards.filter(card => card.id !== body.id);

        await putJsonFile(
          FILES.trackedCards,
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