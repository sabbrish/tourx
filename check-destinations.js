const path = require("path");
require("dotenv").config({ path: path.join(__dirname, ".env") });
const { Pool } = require("pg");

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_SSL === "true" ? { rejectUnauthorized: false } : false
});

(async () => {
  try {
    const { rows } = await pool.query("SELECT id, title, continent, country FROM destinations ORDER BY id;");
    console.log(`Found ${rows.length} destinations:`);
    rows.forEach(r => console.log(`  #${r.id}  title="${r.title}"  continent="${r.continent}"  country="${r.country}"`));
  } catch (err) {
    console.error("Query failed:", err.message);
  } finally {
    await pool.end();
  }
})();
