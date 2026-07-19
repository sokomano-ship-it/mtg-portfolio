const OWNER = process.env.GITHUB_OWNER;
const REPO = process.env.GITHUB_REPO;
const TOKEN = process.env.GITHUB_TOKEN;
const BRANCH = process.env.GITHUB_BRANCH || "main";

const DATA_FILES = {
  observations: "backend/data/marketObservations.json",
  trackedCards: "backend/data/trackedMarketCards.json"
};

function checkDataStoreEnv() {
  return Boolean(OWNER && REPO && TOKEN);
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
  const encodedPath = encodeURIComponent(filePath).replace(/%2F/g, "/");

  return `https://api.github.com/repos/${OWNER}/${REPO}/contents/${encodedPath}`;
}

async function getJsonFile(filePath) {
  if (!checkDataStoreEnv()) {
    throw new Error("Missing GitHub DataStore environment variables");
  }

  const metadataResponse = await fetch(
    `${githubUrl(filePath)}?ref=${BRANCH}`,
    {
      headers: githubHeaders()
    }
  );

  if (metadataResponse.status === 404) {
    return {
      json: [],
      sha: null
    };
  }

  if (!metadataResponse.ok) {
    throw new Error(
      `GitHub GET ${filePath} failed: ` +
      `${metadataResponse.status} ${await metadataResponse.text()}`
    );
  }

  const metadata = await metadataResponse.json();

  const rawResponse = await fetch(
    `${githubUrl(filePath)}?ref=${BRANCH}`,
    {
      headers: {
        ...githubHeaders(),
        Accept: "application/vnd.github.raw+json"
      }
    }
  );

  if (!rawResponse.ok) {
    throw new Error(
      `GitHub RAW GET ${filePath} failed: ` +
      `${rawResponse.status} ${await rawResponse.text()}`
    );
  }

  const content = await rawResponse.text();

  if (!content.trim()) {
    throw new Error(`Le fichier ${filePath} est vide`);
  }

  try {
    return {
      json: JSON.parse(content),
      sha: metadata.sha
    };
  } catch (error) {
    throw new Error(
      `JSON invalide dans ${filePath}: ${error.message}`
    );
  }
}

async function putJsonFile(filePath, json, sha, message) {
  if (!checkDataStoreEnv()) {
    throw new Error("Missing GitHub DataStore environment variables");
  }

  const body = {
    message,
    branch: BRANCH,
    content: Buffer
      .from(JSON.stringify(json, null, 2))
      .toString("base64")
  };

  if (sha) {
    body.sha = sha;
  }

  const response = await fetch(githubUrl(filePath), {
    method: "PUT",
    headers: githubHeaders(),
    body: JSON.stringify(body)
  });

  if (!response.ok) {
    throw new Error(
      `GitHub PUT ${filePath} failed: ` +
      `${response.status} ${await response.text()}`
    );
  }

  return response.json();
}

async function loadMarketObservations() {
  return getJsonFile(DATA_FILES.observations);
}

async function saveMarketObservations(observations, sha, message) {
  return putJsonFile(
    DATA_FILES.observations,
    observations,
    sha,
    message
  );
}

async function loadTrackedMarketCards() {
  return getJsonFile(DATA_FILES.trackedCards);
}

async function saveTrackedMarketCards(trackedCards, sha, message) {
  return putJsonFile(
    DATA_FILES.trackedCards,
    trackedCards,
    sha,
    message
  );
}

module.exports = {
  loadMarketObservations,
  saveMarketObservations,
  loadTrackedMarketCards,
  saveTrackedMarketCards
};