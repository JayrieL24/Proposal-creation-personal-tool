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

const EXCLUDED_BY_DEFAULT = new Set(["Web price"]);
const POLL_MS = 3000;

const ui = {
  statusText: document.getElementById("statusText"),
  rowText: document.getElementById("rowText"),
  updatedText: document.getElementById("updatedText"),
  tableBody: document.getElementById("fieldTableBody"),
  promptOutput: document.getElementById("promptOutput"),
  promptLanguage: document.getElementById("promptLanguage"),
  copyBtn: document.getElementById("copyBtn"),
  refreshBtn: document.getElementById("refreshBtn")
};

let currentRecord = null;
const includeMap = new Map();

for (const field of FIELDS) {
  includeMap.set(field, !EXCLUDED_BY_DEFAULT.has(field));
}

function toDisplay(value) {
  if (value === null || value === undefined || value === "") {
    return '<span class="value-empty">null</span>';
  }
  return escapeHtml(String(value));
}

function escapeHtml(input) {
  return input
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function getSkValue(field) {
  return currentRecord?.[field] ?? null;
}

function getEnValue(field) {
  const translated = currentRecord?.translated?.[field];
  return translated ?? null;
}

function choosePromptValue(field) {
  const mode = ui.promptLanguage.value;
  const sk = getSkValue(field);
  const en = getEnValue(field);

  if (mode === "sk") return sk;
  if (mode === "en") return en;
  return en ?? sk;
}

function buildPrompt() {
  if (!currentRecord) {
    return "";
  }

  const lines = [];
  for (const field of FIELDS) {
    if (!includeMap.get(field)) continue;
    const value = choosePromptValue(field);
    if (value === null || value === undefined || value === "") continue;
    lines.push(`${field}: ${String(value)}`);
  }
  return lines.join("\n");
}

function renderPrompt() {
  ui.promptOutput.value = buildPrompt();
}

function onToggleChange(field, checked) {
  includeMap.set(field, checked);
  renderPrompt();
}

function renderTable() {
  const rows = FIELDS.map((field) => {
    const sk = toDisplay(getSkValue(field));
    const en = toDisplay(getEnValue(field));
    const checked = includeMap.get(field) ? "checked" : "";

    return `
      <tr>
        <td>${escapeHtml(field)}</td>
        <td>${sk}</td>
        <td>${en}</td>
        <td><input type="checkbox" data-field="${escapeHtml(field)}" ${checked} /></td>
      </tr>
    `;
  }).join("");

  ui.tableBody.innerHTML = rows;
  ui.tableBody.querySelectorAll('input[type="checkbox"]').forEach((el) => {
    el.addEventListener("change", (event) => {
      const field = event.target.dataset.field;
      onToggleChange(field, event.target.checked);
    });
  });
}

function updateMeta() {
  const meta = currentRecord?.meta || {};
  ui.rowText.textContent = meta.rowId ? String(meta.rowId) : "-";
  ui.updatedText.textContent = meta.timestamp || "-";
}

function setStatus(text) {
  ui.statusText.textContent = text;
}

async function fetchLatestRecord() {
  try {
    const response = await fetch("/api/latest-record", { cache: "no-store" });
    if (response.status === 404) {
      setStatus("No records yet.");
      return;
    }
    if (!response.ok) {
      setStatus(`Failed to fetch latest record (${response.status})`);
      return;
    }
    const data = await response.json();
    if (!data?.record) {
      setStatus("Latest record payload was empty.");
      return;
    }

    currentRecord = data.record;
    setStatus("Connected. Latest record loaded.");
    updateMeta();
    renderTable();
    renderPrompt();
  } catch (error) {
    setStatus(`Network error: ${error.message}`);
  }
}

ui.promptLanguage.addEventListener("change", renderPrompt);
ui.refreshBtn.addEventListener("click", fetchLatestRecord);
ui.copyBtn.addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(ui.promptOutput.value);
    ui.copyBtn.textContent = "Copied";
    setTimeout(() => {
      ui.copyBtn.textContent = "Copy prompt";
    }, 1000);
  } catch (_error) {
    ui.copyBtn.textContent = "Copy failed";
    setTimeout(() => {
      ui.copyBtn.textContent = "Copy prompt";
    }, 1000);
  }
});

renderTable();
renderPrompt();
fetchLatestRecord();
setInterval(fetchLatestRecord, POLL_MS);
