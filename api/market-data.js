const { Octokit } = require("@octokit/rest");

const OWNER = process.env.GITHUB_OWNER;
const REPO = process.env.GITHUB_REPO;
const TOKEN = process.env.GITHUB_TOKEN;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
const BRANCH = process.env.GITHUB_BRANCH || "main";

const FILES = {
  manualPrices: "backend/data/manualPrices.json",
  observations: "backend/data/marketObservations.json"
};

function checkAuth(req) {
  const password = req.headers["x-admin-password"];
  return password && password === ADMIN_PASSWORD;
}

async function getJsonFile(octokit, path) {
  try {
    const res = await octokit.repos.getContent({
      owner: OWNER,
      repo: REPO,
      path,
      ref: BRANCH
    });

    const content = Buffer.from(res.data.content, "base64").toString("utf8");

    return {
      json: JSON.parse(content),
      sha: res.data.sha
    };
  } catch {
    return {
      json: [],
      sha: null
    };
  }
}

async function putJsonFile(octokit, path, json, sha, message) {
  await octokit.repos.createOrUpdateFileContents({
    owner: OWNER,
    repo: REPO,
    path,
    branch: BRANCH,
    message,
    content: Buffer.from(JSON.stringify(json, null, 2)).toString("base64"),
    sha: sha || undefined
  });
}

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type,x-admin-password");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

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

  const octokit = new Octokit({ auth: TOKEN });

  try {
    if (req.method === "GET") {
      const manual = await getJsonFile(octokit, FILES.manualPrices);
      const observations = await getJsonFile(octokit, FILES.observations);

      return res.json({
        ok: true,
        manualPrices: manual.json,
        observations: observations.json
      });
    }

    if (req.method === "POST") {
      const body = req.body || {};

      if (body.type === "manualPrices") {
        const file = await getJsonFile(octokit, FILES.manualPrices);

        await putJsonFile(
          octokit,
          FILES.manualPrices,
          body.data || [],
          file.sha,
          "Update manual special-card prices"
        );

        return res.json({ ok: true });
      }

      if (body.type === "observation") {
        const file = await getJsonFile(octokit, FILES.observations);
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
          octokit,
          FILES.observations,
          observations,
          file.sha,
          "Add market observation"
        );

        return res.json({ ok: true });
      }

      if (body.type === "deleteObservation") {
        const file = await getJsonFile(octokit, FILES.observations);
        const observations = Array.isArray(file.json) ? file.json : [];
        const filtered = observations.filter(obs => obs.id !== body.id);

        await putJsonFile(
          octokit,
          FILES.observations,
          filtered,
          file.sha,
          "Delete market observation"
        );

        return res.json({ ok: true });
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