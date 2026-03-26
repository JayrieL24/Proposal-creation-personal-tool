# Personal Tool - Proposal Pipeline

Clean project layout for the Google Sheets -> webhook -> prompt builder flow.

## Structure

```
.
|-- backend/
|   |-- server.js
|   `-- webhook-v1.js
|-- frontend/
|   |-- index.html
|   |-- styles.css
|   `-- app.js
|-- package.json
`-- package-lock.json
```

## Run

Install dependencies:

```bash
npm install
```

Set environment variables:

1. Copy `.env.example` to `.env`
2. Fill Azure credentials when you want translation enabled

```bash
copy .env.example .env
```

Start backend + frontend together (recommended):

```bash
npm start
```

Dev mode:

```bash
npm run dev
```

Open frontend in browser:

```text
http://localhost:3000
```

## Translation (Azure Free F0)

This project supports Azure Translator with cache to reduce repeated calls.

Required `.env` values:

```env
ENABLE_TRANSLATION=true
TRANSLATION_PROVIDER=azure
AZURE_TRANSLATOR_KEY=...
AZURE_TRANSLATOR_REGION=...
AZURE_TRANSLATOR_ENDPOINT=https://api.cognitive.microsofttranslator.com
AZURE_TRANSLATOR_FROM=sk
AZURE_TRANSLATOR_TO=en
```

Notes:

- If translation is disabled or credentials are missing, webhook still succeeds and only SK values are used.
- Translation cache is stored in `backend/translation-cache.json`.
- Cached text is reused to stay inside free-tier limits.

## Start Backend and Frontend Separately

This project currently serves the frontend from Express, so backend and frontend run in one process.

- Backend entry: `backend/server.js`
- Frontend files: `frontend/index.html`, `frontend/app.js`, `frontend/styles.css`

If you still want two terminals:

1. Backend terminal:

```bash
npm run dev
```

2. Frontend terminal:

No separate frontend dev server is required right now.
Use browser refresh to see `frontend/` file changes.

## API

- `POST /api/webhook-v1`
- `GET /api/latest-record`
- `GET /api/records`
- `GET /api/health`
