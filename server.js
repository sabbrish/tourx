const path = require("path");
require("dotenv").config({ path: path.join(__dirname, ".env") });
require("dotenv").config({ path: path.join(__dirname, "..", ".env") });

const express = require("express");
const bcrypt = require("bcryptjs");
const { Pool } = require("pg");
const crypto = require("crypto");

const app = express();
const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || "127.0.0.1";
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY || "";
const OPENROUTER_MODEL = process.env.OPENROUTER_MODEL || "openai/gpt-5.4-mini";
const OPENROUTER_STT_MODEL = process.env.OPENROUTER_STT_MODEL || "openai/whisper-1";

// Optional owner login notifications. Never include a user's password.
const OWNER_EMAIL = process.env.TRAVELX_OWNER_EMAIL || "";
const RESEND_API_KEY = process.env.RESEND_API_KEY || "";
const RESEND_FROM_EMAIL = process.env.RESEND_FROM_EMAIL || "TravelX <onboarding@resend.dev>";

async function notifyOwnerOfLogin(user, req) {
  const ip = String(req.headers["x-forwarded-for"] || req.socket.remoteAddress || "unknown").split(",")[0].trim();
  const time = new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" });
  const name = user.full_name || "TravelX user";
  const identifier = user.email || user.phone || "unknown";

  // Always show the notification in the terminal running TravelX.
  console.log("----------------------------------------------");
  console.log("TRAVELX LOGIN NOTIFICATION");
  console.log(`User: ${name}`);
  console.log(`Email/Phone: ${identifier}`);
  console.log(`Time (IST): ${time}`);
  console.log(`IP: ${ip}`);
  console.log("----------------------------------------------");

  // Optional real email notification through Resend.
  if (!OWNER_EMAIL || !RESEND_API_KEY) return;

  try {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${RESEND_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        from: RESEND_FROM_EMAIL,
        to: [OWNER_EMAIL],
        subject: "TravelX - User login notification",
        text: [
          "A user successfully logged in to TravelX.",
          `Name: ${name}`,
          `Email/Phone: ${identifier}`,
          `Time (IST): ${time}`,
          `IP: ${ip}`,
          "The user's password is never sent or included."
        ].join("\n")
      })
    });
    if (!response.ok) {
      console.error("TravelX login email notification failed:", await response.text());
    } else {
      console.log(`Login notification sent to ${OWNER_EMAIL}`);
    }
  } catch (err) {
    console.error("TravelX login email notification error:", err.message);
  }
}

if (!process.env.DATABASE_URL) {
  console.error("ERROR: DATABASE_URL is missing. Create public/.env from .env.example.");
  process.exit(1);
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_SSL === "true" ? { rejectUnauthorized: false } : false
});

app.use(express.json({ limit: "20mb" }));
app.use(express.urlencoded({ extended: true, limit: "2mb" }));
app.use(express.static(__dirname));

const LANGUAGE_NAMES = {
  "en": "English", "hi": "Hindi", "ta": "Tamil", "te": "Telugu",
  "ml": "Malayalam", "kn": "Kannada", "bn": "Bengali", "mr": "Marathi",
  "gu": "Gujarati", "pa": "Punjabi", "ur": "Urdu", "ar": "Arabic",
  "fr": "French", "de": "German", "es": "Spanish", "it": "Italian",
  "pt": "Portuguese", "ja": "Japanese", "ko": "Korean", "zh": "Chinese",
  "ru": "Russian", "tr": "Turkish", "id": "Indonesian", "th": "Thai",
  "vi": "Vietnamese", "nl": "Dutch", "pl": "Polish", "sv": "Swedish",
  "uk": "Ukrainian", "he": "Hebrew", "fa": "Persian", "ne": "Nepali",
  "si": "Sinhala", "sw": "Swahili"
};

function normalizeLanguage(value) {
  const v = String(value || "").trim();
  if (!v) return "en-US";
  const lower = v.toLowerCase();
  const aliases = {
    english: "en-US", hindi: "hi-IN", tamil: "ta-IN", telugu: "te-IN",
    malayalam: "ml-IN", kannada: "kn-IN", bengali: "bn-IN", marathi: "mr-IN",
    gujarati: "gu-IN", punjabi: "pa-IN", urdu: "ur-PK", arabic: "ar-SA",
    french: "fr-FR", german: "de-DE", spanish: "es-ES", italian: "it-IT",
    portuguese: "pt-BR", japanese: "ja-JP", korean: "ko-KR", chinese: "zh-CN",
    russian: "ru-RU", turkish: "tr-TR", indonesian: "id-ID", thai: "th-TH",
    vietnamese: "vi-VN", dutch: "nl-NL", polish: "pl-PL", swedish: "sv-SE",
    ukrainian: "uk-UA", hebrew: "he-IL", persian: "fa-IR", nepali: "ne-NP",
    sinhala: "si-LK", swahili: "sw-KE"
  };
  return aliases[lower] || v;
}

function languageName(code) {
  const base = String(code || "en").toLowerCase().split("-")[0];
  return LANGUAGE_NAMES[base] || code || "the user's language";
}

function safeJsonParse(text) {
  try { return JSON.parse(text); } catch (_) { return null; }
}

function extractChatText(data) {
  const content = data?.choices?.[0]?.message?.content;
  if (typeof content === "string") return content.trim();
  if (Array.isArray(content)) {
    return content.map(part => {
      if (typeof part === "string") return part;
      return part?.text || "";
    }).join("").trim();
  }
  return "";
}

async function callOpenRouter(messages, options = {}) {
  if (!OPENROUTER_API_KEY) {
    const err = new Error("OPENROUTER_API_KEY is not configured.");
    err.code = "OPENROUTER_NOT_CONFIGURED";
    throw err;
  }

  const requestBody = {
    models: [
      options.model || OPENROUTER_MODEL,
      "openai/gpt-5-mini",
      "openai/gpt-4o-mini"
    ].filter(Boolean),

    messages,

    temperature: options.temperature ?? 0.35,

    max_tokens: options.max_tokens || 1200
  };

  console.log(
    "OpenRouter request:",
    JSON.stringify(requestBody, null, 2)
  );

  const response = await fetch(
    "https://openrouter.ai/api/v1/chat/completions",
    {
      method: "POST",

      headers: {
        "Authorization": `Bearer ${OPENROUTER_API_KEY}`,
        "Content-Type": "application/json",
        "HTTP-Referer": "http://127.0.0.1:3000",
        "X-Title": "TravelX"
      },

      body: JSON.stringify(requestBody)
    }
  );

  const raw = await response.text();
  const data = safeJsonParse(raw) || {};

  if (!response.ok) {
    const errorText =
      data?.error?.message ||
      raw ||
      `HTTP ${response.status}`;

    console.error(
      "OpenRouter HTTP error:",
      response.status,
      raw
    );

    throw new Error(
      `OpenRouter ${response.status}: ${errorText.slice(0, 500)}`
    );
  }

  return data;
}

function audioFormatFromMime(mimeType) {
  const base = String(mimeType || "audio/webm").toLowerCase().split(";")[0];
  const map = {
    "audio/webm": "webm",
    "audio/ogg": "ogg",
    "audio/wav": "wav",
    "audio/x-wav": "wav",
    "audio/mpeg": "mp3",
    "audio/mp3": "mp3",
    "audio/mp4": "mp4",
    "audio/m4a": "m4a",
    "audio/aac": "aac",
    "audio/flac": "flac",
    "audio/opus": "opus"
  };
  return map[base] || null;
}

async function transcribeWithOpenRouter(audioBase64, mimeType) {
  if (!OPENROUTER_API_KEY) {
    const err = new Error("OPENROUTER_API_KEY is not configured.");
    err.code = "OPENROUTER_NOT_CONFIGURED";
    throw err;
  }

  const normalizedMimeType = String(mimeType || "audio/webm")
    .toLowerCase()
    .split(";")[0]
    .trim();

  const format = audioFormatFromMime(normalizedMimeType);
  if (!format) {
    throw new Error(`Unsupported audio format: ${normalizedMimeType}`);
  }

  const response = await fetch("https://openrouter.ai/api/v1/audio/transcriptions", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${OPENROUTER_API_KEY}`,
      "Content-Type": "application/json",
      "HTTP-Referer": "http://127.0.0.1:3000",
      "X-Title": "TravelX"
    },
    body: JSON.stringify({
      model: OPENROUTER_STT_MODEL,
      input_audio: {
        data: audioBase64.replace(/^data:[^,]+,/, ""),
        format
      }
    })
  });

  const raw = await response.text();
  const data = safeJsonParse(raw) || {};
  if (!response.ok) {
    const errorText =
      data?.error?.message ||
      raw ||
      `HTTP ${response.status}`;

    console.error(
      "OpenRouter transcription error:",
      response.status,
      raw
    );

    throw new Error(
      `OpenRouter ${response.status}: ${String(errorText).slice(0, 500)}`
    );
  }

  const transcript = String(data?.text || "").trim();
  if (!transcript) throw new Error("OpenRouter returned an empty transcription.");
  return transcript;
}

function buildTextContents(history, message) {
  const contents = [];
  for (const item of Array.isArray(history) ? history.slice(-20) : []) {
    const text = String(item?.text || "").trim();
    if (!text) continue;
    const role = item?.role === "assistant" ? "assistant" : "user";
    contents.push({ role, content: text });
  }
  if (!contents.length || contents[contents.length - 1]?.content !== message) {
    contents.push({ role: "user", content: message });
  }
  return contents;
}

const TRAVEL_SYSTEM = `You are TravelX AI, a helpful multilingual tourism assistant.
Answer the user's actual question accurately and naturally.
LANGUAGE RULE (highest priority): detect the language of the user's latest message and answer in that SAME language. Never translate the answer into English unless the user wrote in English or explicitly asks for English.
If the user mixes languages, use the dominant language of the latest message while preserving proper names and useful travel terms.
Return ONLY valid JSON with exactly these keys:
{"language":"BCP-47 language code","response":"answer"}
The language value must be a BCP-47 code such as en-US, ta-IN, hi-IN, ml-IN, ar-SA, fr-FR, es-ES, ja-JP, zh-CN.
Keep the answer useful for travel planning. Do not invent live prices, availability, weather, visas, or bookings.`;

const VOICE_SYSTEM = `You are TravelX AI, a multilingual voice tourism assistant.
The audio has already been transcribed by the speech-to-text service.
Detect the language of the supplied transcript and answer the user's request.
LANGUAGE RULE (highest priority): reply in the SAME language the user spoke. Do not translate to English unless the user spoke English or explicitly requested English.
If the speaker code-switches, use the dominant language of the utterance.
Return ONLY valid JSON with exactly these keys:
{"language":"BCP-47 language code","response":"answer in the same language"}
The language must be a BCP-47 code.
Do not invent live prices, availability, weather, visas, or bookings.`;

app.get("/api/health", async (req, res) => {
  try {
    await pool.query("SELECT 1");
    res.json({ ok: true, database: "connected", openrouter: Boolean(OPENROUTER_API_KEY), service: "TravelX" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false, database: "disconnected", error: "Database connection failed" });
  }
});

app.get("/api/destinations", async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT d.id, d.title, d.country, d.country_code, d.flag_emoji,
             d.short_description, d.full_description, d.image_url, d.slug,
             d.is_featured, c.name AS continent
      FROM destinations d
      JOIN continents c ON c.id = d.continent_id
      WHERE d.is_featured = TRUE
      ORDER BY d.id
    `);
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Could not load destinations" });
  }
});

app.get("/api/destinations/search", async (req, res) => {
  const q = String(req.query.q || "").trim();
  if (!q) return res.json([]);
  try {
    const { rows } = await pool.query(`
      SELECT d.id, d.title, d.country, d.flag_emoji, d.short_description,
             d.image_url, d.slug, c.name AS continent
      FROM destinations d
      JOIN continents c ON c.id = d.continent_id
      WHERE d.title ILIKE $1 OR d.country ILIKE $1 OR c.name ILIKE $1 OR d.short_description ILIKE $1
      ORDER BY d.is_featured DESC, d.title LIMIT 20
    `, [`%${q}%`]);
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Destination search failed" });
  }
});

app.post("/api/auth/login", async (req, res) => {
  const identifier = String(req.body.identifier || "").trim();
  const password = String(req.body.password || "");
  if (!identifier || password.length < 8) return res.status(400).json({ error: "Email/phone and a password of at least 8 characters are required." });
  try {
    const { rows } = await pool.query(`
      SELECT id, email, phone, password_hash, full_name, preferred_language, dark_mode
      FROM users WHERE (email = $1 OR phone = $1) AND is_active = TRUE LIMIT 1
    `, [identifier]);
    const user = rows[0];
    if (!user || !user.password_hash || !(await bcrypt.compare(password, user.password_hash))) {
      return res.status(401).json({ error: "Invalid email/phone or password." });
    }
    // Notify the owner without delaying the successful login response.
    notifyOwnerOfLogin(user, req).catch(err => {
      console.error("TravelX login notification error:", err.message);
    });

    res.json({ success: true, user: {
      id: user.id, email: user.email, phone: user.phone, fullName: user.full_name,
      preferredLanguage: user.preferred_language, darkMode: user.dark_mode
    }});
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Login failed because of a server/database error." });
  }
});

app.post("/api/auth/register", async (req, res) => {
  const email = String(req.body.email || "").trim() || null;
  const phone = String(req.body.phone || "").trim() || null;
  const fullName = String(req.body.fullName || "").trim() || null;
  const password = String(req.body.password || "");
  if (!email && !phone) return res.status(400).json({ error: "Email or phone is required." });
  if (password.length < 8) return res.status(400).json({ error: "Password must contain at least 8 characters." });
  try {
    const passwordHash = await bcrypt.hash(password, 12);
    const { rows } = await pool.query(`
      INSERT INTO users (email, phone, password_hash, full_name)
      VALUES ($1, $2, $3, $4)
      RETURNING id, email, phone, full_name, preferred_language, dark_mode
    `, [email, phone, passwordHash, fullName]);
    res.status(201).json({ success: true, user: rows[0] });
  } catch (err) {
    console.error(err);
    if (err.code === "23505") return res.status(409).json({ error: "That email or phone is already registered." });
    res.status(500).json({ error: "Registration failed." });
  }
});

async function generateTextAnswer(message, history) {
  const messages = [
    { role: "system", content: TRAVEL_SYSTEM },
    ...buildTextContents(history, message)
  ];
  const data = await callOpenRouter(messages);
  const raw = extractChatText(data);
  const parsed = safeJsonParse(raw.replace(/^```json\\s*/i, "").replace(/\\s*```$/i, "").trim());
  if (parsed?.response) return {
    language: normalizeLanguage(parsed.language),
    response: String(parsed.response).trim()
  };
  if (raw) return { language: "en-US", response: raw };
  throw new Error("OpenRouter returned an empty response.");
}

app.post("/api/chat", async (req, res) => {
  const message = String(req.body.message || "").trim();
  const previousInteractionId = req.body.previousInteractionId || crypto.randomUUID();
  const context = req.body.context || {};
  const history = Array.isArray(req.body.history) ? req.body.history : [];
  if (!message) return res.status(400).json({ error: "Message is required." });
  if (message.length > 2000) return res.status(400).json({ error: "Message is too long." });

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const sessionResult = await client.query(`
      INSERT INTO chat_sessions (interaction_id, context_destination, context_dates, context_travelers)
      VALUES ($1, $2, $3, $4)
      ON CONFLICT (interaction_id) DO UPDATE SET updated_at = CURRENT_TIMESTAMP,
        context_destination = EXCLUDED.context_destination,
        context_dates = EXCLUDED.context_dates,
        context_travelers = EXCLUDED.context_travelers
      RETURNING id
    `, [previousInteractionId, context.userDestination || null, context.userDates || null, Number(context.userTravelers || 1)]);
    const sessionId = sessionResult.rows[0].id;
    await client.query(`INSERT INTO chat_messages (session_id, role, content, is_voice) VALUES ($1, 'user', $2, FALSE)`, [sessionId, message]);

    let result;
    try {
      result = await generateTextAnswer(message, history);
    } catch (aiErr) {
      console.error("OpenRouter chat error:", aiErr.message);
      await client.query("ROLLBACK");
      return res.status(aiErr.code === "OPENROUTER_NOT_CONFIGURED" ? 503 : 502).json({
        error: "TravelX AI is not configured.",
        message: aiErr.code === "OPENROUTER_NOT_CONFIGURED" ? "Add OPENROUTER_API_KEY to public/.env and restart the server." : "OpenRouter could not process the request."
      });
    }

    await client.query(`
      INSERT INTO chat_messages (session_id, role, content, metadata)
      VALUES ($1, 'assistant', $2, $3::jsonb)
    `, [sessionId, result.response, JSON.stringify({ source: "Gemini", language: result.language, languageName: languageName(result.language) })]);
    await client.query("COMMIT");
    res.json({ response: result.response, language: result.language, interactionId: previousInteractionId });
  } catch (err) {
    try { await client.query("ROLLBACK"); } catch (_) {}
    console.error(err);
    res.status(500).json({ error: "Could not save the chat." });
  } finally {
    client.release();
  }
});

app.post("/api/voice", async (req, res) => {
  const audio = String(req.body.audio || "");
  const mimeType = String(req.body.mimeType || "audio/webm");
  const previousInteractionId = req.body.previousInteractionId || crypto.randomUUID();
  const context = req.body.context || {};
  if (!audio) return res.status(400).json({ error: "Audio is required." });
  const normalizedMimeType = String(mimeType || "audio/webm")
    .toLowerCase()
    .split(";")[0]
    .trim();

const audioFormat = audioFormatFromMime(normalizedMimeType);

if (!audioFormat) {
    return res.status(400).json({
        error: `Unsupported audio format: ${normalizedMimeType}`
    });
}
  if (audio.length > 18_000_000) return res.status(413).json({ error: "Voice recording is too large. Please speak for a shorter time." });

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const sessionResult = await client.query(`
      INSERT INTO chat_sessions (interaction_id, context_destination, context_dates, context_travelers)
      VALUES ($1, $2, $3, $4)
      ON CONFLICT (interaction_id) DO UPDATE SET updated_at = CURRENT_TIMESTAMP,
        context_destination = EXCLUDED.context_destination,
        context_dates = EXCLUDED.context_dates,
        context_travelers = EXCLUDED.context_travelers
      RETURNING id
    `, [previousInteractionId, context.destination || null, context.dates || null, Number(context.travelers || 1)]);
    const sessionId = sessionResult.rows[0].id;

    let result;
    try {
      const transcript = await transcribeWithOpenRouter(audio, mimeType);
      const messages = [
        { role: "system", content: VOICE_SYSTEM },
        { role: "user", content: transcript }
      ];
      const data = await callOpenRouter(messages);
      const raw = extractChatText(data);
      const parsed = safeJsonParse(raw.replace(/^```json\\s*/i, "").replace(/\\s*```$/i, "").trim());

      if (parsed?.response) {
        result = {
          language: normalizeLanguage(parsed.language),
          transcript,
          response: String(parsed.response).trim()
        };
      } else if (raw) {
        result = {
          language: "en-US",
          transcript,
          response: raw
        };
      } else {
        throw new Error("OpenRouter returned an empty voice response.");
      }
    } catch (aiErr) {
      console.error("OpenRouter voice error:", aiErr.message);
      await client.query("ROLLBACK");
      return res.status(aiErr.code === "OPENROUTER_NOT_CONFIGURED" ? 503 : 502).json({
        error: "TravelX voice AI is not configured.",
        message: aiErr.code === "OPENROUTER_NOT_CONFIGURED"
          ? "Add OPENROUTER_API_KEY to public/.env and restart the server."
          : "OpenRouter could not understand the voice recording."
      });
    }

    const transcript = result.transcript || "Voice question";
    await client.query(`INSERT INTO chat_messages (session_id, role, content, is_voice, metadata) VALUES ($1, 'user', $2, TRUE, $3::jsonb)`,
      [sessionId, transcript, JSON.stringify({ language: result.language })]);
    await client.query(`INSERT INTO chat_messages (session_id, role, content, metadata) VALUES ($1, 'assistant', $2, $3::jsonb)`,
      [sessionId, result.response, JSON.stringify({ source: "Gemini voice", language: result.language, languageName: languageName(result.language) })]);
    await client.query("COMMIT");
    res.json({ response: result.response, transcript, language: result.language, interactionId: previousInteractionId });
  } catch (err) {
    try { await client.query("ROLLBACK"); } catch (_) {}
    console.error(err);
    res.status(500).json({ error: "Could not save the voice chat." });
  } finally {
    client.release();
  }
});

for (const route of ["/api/flights", "/api/hotels", "/api/weather"]) {
  app.all(route, (req, res) => res.status(501).json({
    error: `${route} is not configured yet.`,
    message: "This TravelX live provider still requires its own API integration/key."
  }));
}

app.get(/.*/, (req, res) => res.sendFile(path.join(__dirname, "index.html")));

if (!process.env.VERCEL) {
  app.listen(PORT, HOST, async () => {
    try {
      await pool.query("SELECT 1");
      console.log("==============================================");
      console.log(`TravelX running: http://${HOST}:${PORT}`);
      console.log("PostgreSQL: connected");
      console.log(`OpenRouter AI: ${OPENROUTER_API_KEY ? "configured" : "NOT configured"}`);
      console.log(`Login notifications: ${OWNER_EMAIL && RESEND_API_KEY ? "email configured" : "terminal only"}`);
      console.log("==============================================");
    } catch (err) {
      console.error("Server started, but PostgreSQL connection failed:", err.message);
    }
  });
}

module.exports = app;