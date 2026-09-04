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
      INSERT INTO destinations
        (continent_id, title, country, country_code, flag_emoji, short_description, image_url, slug, is_featured)
      VALUES
        (7, 'Islands', 'Maldives', 'MV', '🇲🇻',
         'Relax among tropical beaches, peaceful islands and breathtaking natural beauty.',
         'https://images.unsplash.com/photo-1573843981267-be1999ff37cd?auto=format&fit=crop&w=1000&q=80',
         'islands', true)
      ON CONFLICT (slug) DO NOTHING
      RETURNING *;
    `);
    if (rows.length) {
      console.log("Inserted Islands destination:", JSON.stringify(rows[0], null, 2));
    } else {
      console.log("No row inserted (a destination with slug is already exist).");
    }
  } catch (err) {
    console.error("Insert failed:", err.message);
  } finally {
    await pool.end();
  }
})();
