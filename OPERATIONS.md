# Operations Runbook

This runbook closes Phase 3 hardening and includes frontend deployment as the final step.

## 1) Security Rotation (WEBHOOK_SECRET)

Rotate the webhook secret periodically.

### A. Generate new secret

Use a long random string (24+ chars), example:

```text
ptl_4f9a7c2d1e8b6a3f0c5d9e2b
```

### B. Update backend secret (Render)

In Render service environment variables:

- `WEBHOOK_SECRET=<new_secret>`

Save and redeploy.

### C. Update Apps Script

In `Code.gs`:

```javascript
const WEBHOOK_SECRET = "<new_secret>";
```

And in `sendWebhook()` options:

```javascript
headers: { "x-webhook-secret": WEBHOOK_SECRET }
```

### D. Verify

1. Edit one row in `Free Proposal` (row >= 76)
2. Check `https://proposal-creation-personal-tool.onrender.com/api/records`
3. Confirm updated row appears
4. If not, check Apps Script Executions for `401 Unauthorized`

---

## 2) Daily Monitoring Checklist

Run this quick check daily (or before demos):

### A. Health

Open:

```text
https://proposal-creation-personal-tool.onrender.com/api/health
```

Expected:

- `"status":"ok"`
- `"persistence":"postgres"`
- `"database":{"enabled":true,"status":"ok"}`

### B. Records sanity

Open:

```text
https://proposal-creation-personal-tool.onrender.com/api/records
```

Expected:

- `count` is stable/increasing (no unexpected drop)

### C. Translation sanity

In UI, select a row with text in `Industry` or notes and click `EN` button.
Expected: EN value is not empty.

---

## 3) Data Recovery / Backfill

If records look incomplete or after major changes:

1. Open Apps Script
2. Run function `syncFromRow76()`
3. Wait for completion
4. Refresh frontend

This re-sends existing rows starting from row 76.

---

## 4) Stable Release + Backup

Before a production freeze:

### A. Tag stable build

```bash
git tag phase3-stable
git push origin phase3-stable
```

### B. Backup critical env values in secure vault

- `DATABASE_URL`
- `WEBHOOK_SECRET`
- `ENABLE_TRANSLATION`
- `AZURE_TRANSLATOR_KEY`
- `AZURE_TRANSLATOR_REGION`
- `AZURE_TRANSLATOR_ENDPOINT`
- `AZURE_TRANSLATOR_FROM`
- `AZURE_TRANSLATOR_TO`

---

## 5) Frontend Deployment (Final)

Deploy frontend on Netlify (static hosting).

### A. Make frontend call Render API

In `frontend/app.js`, set:

```javascript
const API_BASE = "https://proposal-creation-personal-tool.onrender.com";
```

Then use:

```javascript
fetch(`${API_BASE}/api/records`, { cache: "no-store" });
```

### B. Netlify settings

- Import from Git
- Base directory: `frontend`
- Build command: leave empty
- Publish directory: `.`

### C. Verify after deploy

1. Open Netlify URL
2. Confirm rows load
3. Check row selection, EN popover, prompt modal, reset/undo reset

---

## Incident Quick Fixes

### Webhook not updating

- Confirm Apps Script trigger exists (`onEdit`)
- Confirm `WEBHOOK_URL` points to Render
- Confirm `WEBHOOK_SECRET` matches on both sides

### Translation empty

- Check `/api/health` => `translationEnabled: true`
- Edit row field and re-trigger webhook
- Check Render logs for `translation.field_failed`

### Missing records

- Confirm `/api/health` persistence is `postgres`
- Run `syncFromRow76()`
