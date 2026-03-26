import express from "express";
import cors from "cors";
import crypto from "crypto";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

try {
  await import("dotenv/config");
} catch (_error) {
  // dotenv is optional in production when env vars are provided by the platform.
}

const app = express();
const PORT = process.env.PORT || 3000;
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, "..", "frontend")));

const dedupeSet = new Set();
let lastRecord = null;
const CACHE_PATH = path.join(__dirname, "translation-cache.json");
const translationCache = new Map();

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
      console.error(`[translation] field "${field}" failed`, error.message);
    }
  }

  return translated;
}

app.post("/api/webhook-v1", async (req, res) => {
  const body = req.body;
  if (!body || !body.meta || !body.meta.eventId || !body.meta.rowId) {
    return res.status(400).json({ error: "Invalid body: meta.eventId + meta.rowId required" });
  }

  const { sheetName, rowId, eventId } = body.meta;
  const key = `${sheetName}:${rowId}:${eventId}`;

  if (dedupeSet.has(key)) {
    return res.status(200).json({ status: "duplicate_ignored" });
  }

  dedupeSet.add(key);
  const normalized = normalizeRecord(body);
  normalized.translated = await translateRecord(normalized);

  lastRecord = normalized;
  console.log("[webhook-v1] got record", key);
  return res.status(200).json({ status: "ok", record: normalized });
});

app.get("/api/latest-record", (req, res) => {
  if (!lastRecord) {
    return res.status(404).json({ error: "No record yet" });
  }
  res.status(200).json({ record: lastRecord });
});

app.get("/api/health", (req, res) => {
  res.status(200).json({
    status: "ok",
    translationEnabled: canUseTranslation(),
    translationProvider: translationConfig.provider,
    translationTarget: translationConfig.to
  });
});

app.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});
