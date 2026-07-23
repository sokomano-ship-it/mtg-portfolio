require("dotenv").config();

const db = require("./turso");

(async () => {
  try {
    const result = await db.execute(
      "SELECT COUNT(*) AS total FROM cards"
    );

    console.log(result.rows[0]);
  } catch (err) {
    console.error(err);
  }
})();