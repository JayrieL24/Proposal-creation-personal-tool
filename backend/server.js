import express from "express";
import cors from "cors";
import crypto from "crypto";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import pg from "pg";

try {
  await import("dotenv/config");
} catch (_error) {
  // dotenv is optional in production when env vars are provided by the platform.
}

const app = express();
const PORT = process.env.PORT || 3000;
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const { Pool } = pg;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, "..", "frontend")));

const dedupeSet = new Set();
let lastRecord = null;
const recordsByRowId = new Map();
const CACHE_PATH = path.join(__dirname, "translation-cache.json");
const translationCache = new Map();
const DATABASE_URL = process.env.DATABASE_URL || "";
const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET || "";
const useDb = Boolean(DATABASE_URL);
const pool = useDb
  ? new Pool({
      connectionString: DATABASE_URL,
      ssl: process.env.PGSSL === "disable" ? false : { rejectUnauthorized: false }
    })
  : null;

const FIELDS = [
  "First",
  "Last",
  "City",
  "Company",
  "Industry",
  "Web price",
  "Website",
  "Email",
  "Phone",
  "Erik's call notes",
  "Info for Coders",
  "Info"
];

const NON_TRANSLATABLE_FIELDS = new Set(["Web price", "Website", "Email", "Phone"]);

const translationConfig = {
  enabled: process.env.ENABLE_TRANSLATION === "true",
  provider: process.env.TRANSLATION_PROVIDER || "azure",
  endpoint: process.env.AZURE_TRANSLATOR_ENDPOINT || "https://api.cognitive.microsofttranslator.com",
  key: process.env.AZURE_TRANSLATOR_KEY || "",
  region: process.env.AZURE_TRANSLATOR_REGION || "",
  from: process.env.AZURE_TRANSLATOR_FROM || "",
  to: process.env.AZURE_TRANSLATOR_TO || "en"
};

loadTranslationCache();

function logInfo(event, payload = {}) {
  console.log(JSON.stringify({ level: "info", event, timestamp: new Date().toISOString(), ...payload }));
}

function logWarn(event, payload = {}) {
  console.warn(JSON.stringify({ level: "warn", event, timestamp: new Date().toISOString(), ...payload }));
}

function logError(event, payload = {}) {
  console.error(JSON.stringify({ level: "error", event, timestamp: new Date().toISOString(), ...payload }));
}

async function initializeDatabase() {
  if (!useDb) {
    logWarn("db.disabled", { reason: "DATABASE_URL not set", persistence: "memory" });
    return;
  }

  await pool.query(`
    CREATE TABLE IF NOT EXISTS proposal_records (
      sheet_name TEXT NOT NULL,
      row_id INTEGER NOT NULL,
      record_data JSONB NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (sheet_name, row_id)
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS processed_events (
      event_key TEXT PRIMARY KEY,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  logInfo("db.ready", { persistence: "postgres" });
}

function normalizeRecord(raw) {
  const record = {};
  FIELDS.forEach((field) => {
    if (Object.prototype.hasOwnProperty.call(raw, field)) {
      const value = raw[field];
      record[field] = value === "" ? null : value;
    } else {
      record[field] = null;
    }
  });

  record.meta = raw.meta || {};
  return record;
}

function loadTranslationCache() {
  if (!fs.existsSync(CACHE_PATH)) return;
  try {
    const cacheJson = fs.readFileSync(CACHE_PATH, "utf8");
    const parsed = JSON.parse(cacheJson);
    for (const [key, value] of Object.entries(parsed)) {
      translationCache.set(key, value);
    }
    console.log(`[translation] cache loaded: ${translationCache.size} entries`);
  } catch (error) {
    console.error("[translation] failed to load cache", error.message);
  }
}

function saveTranslationCache() {
  try {
    const serializable = Object.fromEntries(translationCache);
    fs.writeFileSync(CACHE_PATH, JSON.stringify(serializable, null, 2), "utf8");
  } catch (error) {
    console.error("[translation] failed to save cache", error.message);
  }
}

function canUseTranslation() {
  if (!translationConfig.enabled) return false;
  if (translationConfig.provider !== "azure") return false;
  return Boolean(translationConfig.key && translationConfig.region);
}

function isRecordEmpty(record) {
  return FIELDS.every((field) => {
    const value = record[field];
    return value === null || value === undefined || value === "";
  });
}

function isWebhookAuthorized(req) {
  if (!WEBHOOK_SECRET) return true;
  const provided = req.get("x-webhook-secret");
  return provided === WEBHOOK_SECRET;
}

function cacheKey(from, to, text) {
  return `${from || "auto"}->${to}:${text}`;
}

async function translateWithAzure(text) {
  const fromParam = translationConfig.from ? `&from=${encodeURIComponent(translationConfig.from)}` : "";
  const url = `${translationConfig.endpoint}/translate?api-version=3.0&to=${encodeURIComponent(translationConfig.to)}${fromParam}`;
  const headers = {
    "Content-Type": "application/json",
    "Ocp-Apim-Subscription-Key": translationConfig.key,
    "Ocp-Apim-Subscription-Region": translationConfig.region,
    "X-ClientTraceId": crypto.randomUUID()
  };

  const response = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify([{ text }])
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Azure translation failed (${response.status}): ${errorText}`);
  }

  const data = await response.json();
  return data?.[0]?.translations?.[0]?.text || null;
}

async function translateText(text) {
  const key = cacheKey(translationConfig.from, translationConfig.to, text);
  if (translationCache.has(key)) {
    return translationCache.get(key);
  }

  const translated = await translateWithAzure(text);
  translationCache.set(key, translated);
  saveTranslationCache();
  return translated;
}

async function translateRecord(record) {
  if (!canUseTranslation()) return null;

  const translated = {};
  for (const field of FIELDS) {
    const value = record[field];
    if (value === null || value === undefined || value === "") {
      translated[field] = null;
      continue;
    }
    if (NON_TRANSLATABLE_FIELDS.has(field)) {
      translated[field] = String(value);
      continue;
    }

    try {
      translated[field] = await translateText(String(value));
    } catch (error) {
      translated[field] = null;
      logError("translation.field_failed", { field, error: error.message });
    }
  }

  return translated;
}

async function reserveEventKey(eventKey) {
  if (!useDb) {
    if (dedupeSet.has(eventKey)) return false;
    dedupeSet.add(eventKey);
    return true;
  }

  const result = await pool.query(
    "INSERT INTO processed_events (event_key) VALUES ($1) ON CONFLICT DO NOTHING RETURNING event_key",
    [eventKey]
  );
  return result.rowCount > 0;
}

async function saveRecord(record) {
  const sheetName = String(record?.meta?.sheetName || "unknown");
  const rowId = Number(record?.meta?.rowId || 0);

  if (!useDb) {
    recordsByRowId.set(String(rowId), record);
    lastRecord = record;
    return;
  }

  await pool.query(
    `
      INSERT INTO proposal_records (sheet_name, row_id, record_data, updated_at)
      VALUES ($1, $2, $3::jsonb, NOW())
      ON CONFLICT (sheet_name, row_id)
      DO UPDATE SET record_data = EXCLUDED.record_data, updated_at = NOW()
    `,
    [sheetName, rowId, JSON.stringify(record)]
  );
}

async function getLatestRecord() {
  if (!useDb) return lastRecord;

  const result = await pool.query(
    `
      SELECT record_data
      FROM proposal_records
      ORDER BY updated_at DESC
      LIMIT 1
    `
  );
  if (result.rowCount === 0) return null;
  return result.rows[0].record_data;
}

async function getAllRecords() {
  if (!useDb) {
    return Array.from(recordsByRowId.values())
      .sort((a, b) => Number(a?.meta?.rowId || 0) - Number(b?.meta?.rowId || 0));
  }

  const result = await pool.query(
    `
      SELECT record_data
      FROM proposal_records
      ORDER BY row_id ASC
    `
  );
  return result.rows.map((row) => row.record_data);
}

app.post("/api/webhook-v1", async (req, res) => {
  try {
    const startedAt = Date.now();
    const body = req.body;
    if (!body || !body.meta || !body.meta.eventId || !body.meta.rowId) {
      logWarn("webhook.invalid_body", { hasMeta: Boolean(body?.meta) });
      return res.status(400).json({ error: "Invalid body: meta.eventId + meta.rowId required" });
    }

    if (!isWebhookAuthorized(req)) {
      logWarn("webhook.unauthorized", { rowId: body.meta.rowId, sheetName: body.meta.sheetName || null });
      return res.status(401).json({ error: "Unauthorized webhook request" });
    }

    const { sheetName, rowId, eventId } = body.meta;
    const key = `${sheetName}:${rowId}:${eventId}`;
    logInfo("webhook.received", { key, sheetName, rowId, eventId });

    const reserved = await reserveEventKey(key);
    if (!reserved) {
      logInfo("webhook.duplicate_ignored", { key });
      return res.status(200).json({ status: "duplicate_ignored" });
    }

    const normalized = normalizeRecord(body);
    if (isRecordEmpty(normalized)) {
      logInfo("webhook.empty_row_ignored", { key, rowId, sheetName });
      return res.status(200).json({ status: "empty_row_ignored" });
    }

    normalized.translated = await translateRecord(normalized);

    await saveRecord(normalized);
    lastRecord = normalized;
    recordsByRowId.set(String(rowId), normalized);
    logInfo("webhook.processed", {
      key,
      rowId,
      sheetName,
      translated: Boolean(normalized.translated),
      durationMs: Date.now() - startedAt
    });
    return res.status(200).json({ status: "ok", record: normalized });
  } catch (error) {
    logError("webhook.error", { error: error.message });
    return res.status(500).json({ error: "Internal server error" });
  }
});

app.get("/api/latest-record", async (req, res) => {
  try {
    const record = await getLatestRecord();
    if (!record) {
      return res.status(404).json({ error: "No record yet" });
    }
    res.status(200).json({ record });
  } catch (error) {
    logError("latest_record.error", { error: error.message });
    res.status(500).json({ error: "Internal server error" });
  }
});

app.get("/api/records", async (req, res) => {
  try {
    const records = await getAllRecords();
    res.status(200).json({
      count: records.length,
      records
    });
  } catch (error) {
    logError("records.error", { error: error.message });
    res.status(500).json({ error: "Internal server error" });
  }
});

app.get("/api/health", async (req, res) => {
  let database = {
    enabled: useDb,
    status: useDb ? "unknown" : "disabled"
  };

  if (useDb) {
    try {
      await pool.query("SELECT 1");
      database = { enabled: true, status: "ok" };
    } catch (error) {
      database = { enabled: true, status: "error", error: error.message };
    }
  }

  res.status(200).json({
    status: "ok",
    persistence: useDb ? "postgres" : "memory",
    database,
    translationEnabled: canUseTranslation(),
    translationProvider: translationConfig.provider,
    translationTarget: translationConfig.to
  });
});

try {
  await initializeDatabase();
  app.listen(PORT, () => {
    console.log(`Server listening on port ${PORT}`);
  });
} catch (error) {
  logError("startup.failed", { error: error.message });
  process.exit(1);
}
