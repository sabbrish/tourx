const path = require("path");
require("dotenv").config({ path: path.join(__dirname, ".env") });
const { Pool } = require("pg");

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_SSL === "true" ? { rejectUnauthorized: false } : false
});

(async () => {
  try {
    const { rows } = await pool.query(`
      SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'public';
    `);
    console.log("Tables in database:");
    rows.forEach(r => console.log(" -", r.table_name));

    const cont = await pool.query("SELECT * FROM continents ORDER BY id;").catch(e => ({ error: e.message }));
    if (cont.error) {
      console.log("\nNo continents table (or query failed):", cont.error);
    } else {
      console.log("\nContinents table rows:");
      cont.rows.forEach(r => console.log(" ", JSON.stringify(r)));
    }
  } catch (err) {
    console.error("Query failed:", err.message);
  } finally {
    await pool.end();
  }
})();
