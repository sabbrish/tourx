// run-schema.js
// One-off script: loads database.sql and runs it against DATABASE_URL.
// Usage:  node run-schema.js
//
// Reads DATABASE_URL from .env (same file your server.js already uses).

const fs = require("fs");
const path = require("path");
require("dotenv").config({ path: path.join(__dirname, ".env") });

const { Pool } = require("pg");

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error("ERROR: DATABASE_URL is not set in your .env file.");
  process.exit(1);
}

// Look for database.sql either right next to this script,
// or one folder up (covers both the public/ and root layouts).
const candidatePaths = [
  path.join(__dirname, "database.sql"),
  path.join(__dirname, "..", "database.sql")
];
const sqlPath = candidatePaths.find(p => fs.existsSync(p));

if (!sqlPath) {
  console.error("ERROR: Could not find database.sql next to this script or one folder up.");
  console.error("Checked:", candidatePaths.join(", "));
  process.exit(1);
}

const sql = fs.readFileSync(sqlPath, "utf8");
console.log(`Loaded ${sqlPath} (${sql.length} bytes). Connecting...`);

const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: { rejectUnauthorized: false } // Neon requires SSL; this matches DATABASE_SSL=true behavior
});

(async () => {
  const client = await pool.connect();
  try {
    console.log("Connected. Running schema...");
    await client.query(sql);
    console.log("✅ Schema applied successfully.");
  } catch (err) {
    console.error("❌ Failed to run schema:", err.message);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
})();
