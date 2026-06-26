module.exports = async function handler(req, res) {
  // CORS
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader(
    "Access-Control-Allow-Headers",
    "Content-Type,x-admin-password"
  );

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  // Informations de diagnostic
  const info = {
    ok: true,
    message: "market-data API is alive",
    node: process.version,
    env: {
      hasOwner: !!process.env.GITHUB_OWNER,
      hasRepo: !!process.env.GITHUB_REPO,
      hasToken: !!process.env.GITHUB_TOKEN,
      hasPassword: !!process.env.ADMIN_PASSWORD,
      branch: process.env.GITHUB_BRANCH || "main"
    }
  };

  return res.status(200).json(info);
};