const OWNER = process.env.GITHUB_OWNER;
const REPO = process.env.GITHUB_REPO;
const TOKEN = process.env.GITHUB_TOKEN;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
const BRANCH = process.env.GITHUB_BRANCH || "main";

const FILES = {
  manualPrices: "backend/data/manualPrices.json",
  observations: "backend/data/marketObservations.json"
};

function sendCors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type,x-admin-password");
}

function checkAuth(req) {
  const password = req.headers["x-admin-password"];
  return password && password === ADMIN_PASSWORD;
}

function githubHeaders() {
  return {
    Authorization: `Bearer ${TOKEN}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "Content-Type": "application/json"
  };
}

async function getJsonFile(path) {
  const url =
    `https://api.github.com/repos/${OWNER}/${REPO}/contents/${encodeURIComponent(path).replace(/%2F/g, "/")}?ref=${BRANCH}`;

  const response = await fetch(url, {
    method: "GET",
    headers: githubHeaders()
  });

  if (response.status === 404) {
    return { json: [], sha: null };
  }

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`GitHub GET failed ${response.status}: ${text}`);
  }

  const data = await response.json();
  const content = Buffer.from(data.content, "base64").toString("utf8");

  return {
    json: JSON.parse(content),
    sha: data.sha
  };
}

async function putJsonFile(path, json, sha, message) {
  const url =
    `https://api.github.com/repos/${OWNER}/${REPO}/contents/${encodeURIComponent(path).replace(/%2F/g, "/")}`;

  const body = {
    message,
    branch: BRANCH,
    content: Buffer.from(JSON.stringify(json, null, 2)).toString("base64")
  };

  if (sha) body.sha = sha;

  const response = await fetch(url, {
    method: "PUT",
    headers: githubHeaders(),
    body: JSON.stringify(body)
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`GitHub PUT failed ${response.status}: ${text}`);
  }

  return response.json();
}

module.exports = async function handler(req, res) {
  sendCors(res);

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  try {
    if (!OWNER || !REPO || !TOKEN || !ADMIN_PASSWORD) {
      return res.status(500).json({
        ok: false,
        error: "Missing Vercel environment variables"
      });
    }

    if (!checkAuth(req)) {
      return res.status(401).json({
        ok: false,
        error: "Unauthorized"
      });
    }

    if (req.method === "GET") {
      const manual = await getJsonFile(FILES.manualPrices);
      const observations = await getJsonFile(FILES.observations);

      return res.status(200).json({
        ok: true,
        manualPrices: manual.json,
        observations: observations.json
      });
    }

    if (req.method === "POST") {
      const body = req.body || {};

      if (body.type === "manualPrices") {
        const file = await getJsonFile(FILES.manualPrices);

        await putJsonFile(
          FILES.manualPrices,
          body.data || [],
          file.sha,
          "Update manual special-card prices"
        );

        return res.status(200).json({ ok: true });
      }

      if (body.type === "observation") {
        const file = await getJsonFile(FILES.observations);
        const observations = Array.isArray(file.json) ? file.json : [];

        observations.push({
          id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
          date: body.date || new Date().toISOString().slice(0, 10),
          nomCarte: body.nomCarte || "",
          edition: body.edition || "",
          langue: body.langue || "",
          condition: body.condition || "",
          observedMinPrice: Number(body.observedMinPrice || 0),
          source: body.source || "Cardmarket lowest observed",
          comment: body.comment || "",
          createdAt: new Date().toISOString()
        });

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

      return res.status(400).json({
        ok: false,
        error: "Unknown POST type"
      });
    }

    return res.status(405).json({
      ok: false,
      error: "Method not allowed"
    });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      error: error.message
    });
  }
};