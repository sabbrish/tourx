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
      SELECT column_name FROM information_schema.columns
      WHERE table_name = 'destinations' ORDER BY ordinal_position;
    `);
    console.log("Columns in destinations table:");
    rows.forEach(r => console.log(" -", r.column_name));

    const data = await pool.query("SELECT * FROM destinations ORDER BY id;");
    console.log(`\nFound ${data.rows.length} rows:`);
    data.rows.forEach(r => console.log(" ", JSON.stringify(r)));
  } catch (err) {
    console.error("Query failed:", err.message);
  } finally {
    await pool.end();
  }
})();
