// Next.js / any Node API webhook endpoint example.
// Replace this path with your real project path or route file (e.g. pages/api/webhook-v1.ts).

const dedupeSet = new Set();

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method Not Allowed" });
  }

  const body = req.body;
  if (!body || !body.meta || !body.meta.eventId) {
    return res.status(400).json({ error: "Invalid body" });
  }

  const { sheetName, rowId, eventId } = body.meta;
  const key = `${sheetName}:${rowId}:${eventId}`;
  if (dedupeSet.has(key)) {
    return res.status(200).json({ status: "duplicate_ignored" });
  }

  dedupeSet.add(key);

  const normalized = normalizeRecord(body);

  // TODO: insert translation + real-time broadcast here.
  // e.g., await translateRecord(normalized);
  //       await broadcastToClients(normalized);

  return res.status(200).json({ status: "ok", record: normalized });
}

function normalizeRecord(raw) {
  const fields = [
    "First", "Last", "City", "Company", "Industry",
    "Web price", "Website", "Email", "Phone",
    "Erik's call notes", "Info for Coders", "Info"
  ];

  const record = {};
  fields.forEach((field) => {
    if (Object.prototype.hasOwnProperty.call(raw, field)) {
      const value = raw[field];
      record[field] = value === "" ? null : value;
    } else {
      record[field] = null;
    }
  });

  record.meta = raw.meta;
  return record;
}
