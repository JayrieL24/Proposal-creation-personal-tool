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
const COLUMN_KEY = "proposal_rows_columns_v1";

const DEFAULT_COLUMNS = [
  { id: "select", label: "Use", type: "select" },
  { id: "row", label: "Row", type: "meta" },
  { id: "company_sk", label: "Company (SK)", type: "field", field: "Company", lang: "sk" },
  { id: "company_en", label: "Company (EN)", type: "field", field: "Company", lang: "en" },
  { id: "contact_sk", label: "Contact (SK)", type: "contact", lang: "sk" },
  { id: "contact_en", label: "Contact (EN)", type: "contact", lang: "en" },
  { id: "city_sk", label: "City (SK)", type: "field", field: "City", lang: "sk" },
  { id: "city_en", label: "City (EN)", type: "field", field: "City", lang: "en" },
  { id: "updated", label: "Updated", type: "meta" },
  { id: "action", label: "Action", type: "action" }
];

const ui = {
  statusText: document.getElementById("statusText"),
  rowText: document.getElementById("rowText"),
  updatedText: document.getElementById("updatedText"),
  rowTableHead: document.getElementById("rowTableHead"),
  rowTableBody: document.getElementById("rowTableBody"),
  rowCountText: document.getElementById("rowCountText"),
  promptOutput: document.getElementById("promptOutput"),
  promptLanguage: document.getElementById("promptLanguage"),
  copyBtn: document.getElementById("copyBtn"),
  refreshBtn: document.getElementById("refreshBtn"),
  openPromptBtn: document.getElementById("openPromptBtn"),
  closePromptBtn: document.getElementById("closePromptBtn"),
  promptModal: document.getElementById("promptModal")
};

let currentRecord = null;
let latestRecord = null;
const recordsByRowId = new Map();
const includeMap = new Map();
let columns = loadColumns();

for (const field of FIELDS) {
  includeMap.set(field, !EXCLUDED_BY_DEFAULT.has(field));
}

function loadColumns() {
  const raw = localStorage.getItem(COLUMN_KEY);
  if (!raw) return [...DEFAULT_COLUMNS];
  try {
    const parsed = JSON.parse(raw);
    const map = new Map(DEFAULT_COLUMNS.map((c) => [c.id, c]));
    const sanitized = [];
    parsed.forEach((id) => {
      if (map.has(id)) sanitized.push(map.get(id));
    });
    DEFAULT_COLUMNS.forEach((column) => {
      if (!sanitized.some((item) => item.id === column.id)) sanitized.push(column);
    });
    return sanitized;
  } catch (_error) {
    return [...DEFAULT_COLUMNS];
  }
}

function saveColumns() {
  localStorage.setItem(COLUMN_KEY, JSON.stringify(columns.map((column) => column.id)));
}

function escapeHtml(input) {
  return String(input)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function displayValue(value) {
  if (value === null || value === undefined || value === "") {
    return '<span class="value-empty">Empty</span>';
  }
  return escapeHtml(value);
}

function getSkValue(field, record = currentRecord) {
  return record?.[field] ?? null;
}

function getEnValue(field, record = currentRecord) {
  return record?.translated?.[field] ?? null;
}

function getValueByLanguage(field, lang, record = currentRecord) {
  if (lang === "en") return getEnValue(field, record);
  return getSkValue(field, record);
}

function choosePromptValue(field, record = currentRecord) {
  const mode = ui.promptLanguage.value;
  const sk = getSkValue(field, record);
  const en = getEnValue(field, record);

  if (mode === "sk") return sk;
  if (mode === "en") return en;
  return en ?? sk;
}

function getCompanyDisplay(record, lang = "sk") {
  const company = getValueByLanguage("Company", lang, record);
  if (company) return company;
  const first = getValueByLanguage("First", lang, record);
  const last = getValueByLanguage("Last", lang, record);
  const fallback = [first, last].filter(Boolean).join(" ").trim();
  return fallback || null;
}

function getContactDisplay(record, lang = "sk") {
  const first = getValueByLanguage("First", lang, record);
  const last = getValueByLanguage("Last", lang, record);
  const full = [first, last].filter(Boolean).join(" ").trim();
  return full || null;
}

function buildPromptForRecord(record) {
  if (!record) return "";

  const lines = [];
  const companyValue = choosePromptValue("Company", record);
  const firstValue = choosePromptValue("First", record);
  const lastValue = choosePromptValue("Last", record);
  const companyMissing = companyValue === null || companyValue === undefined || companyValue === "";
  const fallbackName = [firstValue, lastValue]
    .filter((value) => value !== null && value !== undefined && value !== "")
    .join(" ")
    .trim();

  for (const field of FIELDS) {
    if (!includeMap.get(field)) continue;
    let value = choosePromptValue(field, record);
    if (field === "Company" && companyMissing && fallbackName) value = fallbackName;
    if (value === null || value === undefined || value === "") continue;
    lines.push(`${field}: ${value}`);
  }
  return lines.join("\n");
}

function setStatus(text) {
  ui.statusText.textContent = text;
}

function renderPrompt() {
  ui.promptOutput.value = buildPromptForRecord(currentRecord);
}

function setCurrentRecord(record) {
  currentRecord = record;
  const meta = record?.meta || {};
  ui.rowText.textContent = meta.rowId ? String(meta.rowId) : "-";
  ui.updatedText.textContent = meta.timestamp || "-";
  renderPrompt();
}

function columnCellContent(column, record) {
  if (column.id === "select") {
    const rowId = String(record?.meta?.rowId ?? "");
    const isSelected = String(currentRecord?.meta?.rowId ?? "") === rowId;
    return `<input type="checkbox" data-select-row-id="${escapeHtml(rowId)}" ${isSelected ? "checked" : ""} />`;
  }
  if (column.id === "row") return displayValue(record?.meta?.rowId ?? "-");
  if (column.id === "updated") return displayValue(record?.meta?.timestamp ?? "-");
  if (column.id === "action") {
    const rowId = String(record?.meta?.rowId ?? "");
    return `
      <button type="button" class="btn-ghost" data-copy-row-id="${escapeHtml(rowId)}">Copy Prompt</button>
    `;
  }
  if (column.type === "contact") {
    return displayValue(getContactDisplay(record, column.lang));
  }
  if (column.id === "company_sk") return displayValue(getCompanyDisplay(record, "sk"));
  if (column.id === "company_en") return displayValue(getCompanyDisplay(record, "en"));
  return displayValue(getValueByLanguage(column.field, column.lang, record));
}

function renderHeader() {
  ui.rowTableHead.innerHTML = `
    <tr>
      ${columns.map((column, index) => `
        <th draggable="true" data-col-index="${index}" title="Drag to reorder">
          ${escapeHtml(column.label)}
        </th>
      `).join("")}
    </tr>
  `;

  let dragIndex = null;
  ui.rowTableHead.querySelectorAll("th[data-col-index]").forEach((th) => {
    th.addEventListener("dragstart", (event) => {
      dragIndex = Number(event.target.dataset.colIndex);
      event.dataTransfer.effectAllowed = "move";
    });
    th.addEventListener("dragover", (event) => {
      event.preventDefault();
      event.dataTransfer.dropEffect = "move";
    });
    th.addEventListener("drop", (event) => {
      event.preventDefault();
      const dropIndex = Number(event.target.dataset.colIndex);
      if (dragIndex === null || dragIndex === dropIndex) return;
      const nextColumns = [...columns];
      const [moved] = nextColumns.splice(dragIndex, 1);
      nextColumns.splice(dropIndex, 0, moved);
      columns = nextColumns;
      saveColumns();
      renderRowTable();
    });
  });
}

function renderRowTable() {
  renderHeader();
  const rows = Array.from(recordsByRowId.values())
    .sort((a, b) => Number(a?.meta?.rowId || 0) - Number(b?.meta?.rowId || 0));

  if (rows.length === 0) {
    ui.rowTableBody.innerHTML = `<tr><td colspan="${columns.length}"><span class="value-empty">No rows loaded yet.</span></td></tr>`;
    return;
  }

  ui.rowTableBody.innerHTML = rows.map((record) => `
    <tr>
      ${columns.map((column) => `<td>${columnCellContent(column, record)}</td>`).join("")}
    </tr>
  `).join("");

  ui.rowTableBody.querySelectorAll("input[data-select-row-id]").forEach((checkbox) => {
    checkbox.addEventListener("change", (event) => {
      const rowId = event.target.dataset.selectRowId;
      const selectedRecord = recordsByRowId.get(rowId);
      if (!selectedRecord) return;
      if (!event.target.checked) {
        // Keep one row selected so prompt context is always clear.
        renderRowTable();
        return;
      }
      setCurrentRecord(selectedRecord);
      renderRowTable();
    });
  });

  ui.rowTableBody.querySelectorAll("button[data-copy-row-id]").forEach((button) => {
    button.addEventListener("click", async (event) => {
      const rowId = event.target.dataset.copyRowId;
      const selectedRecord = recordsByRowId.get(rowId);
      if (!selectedRecord) return;
      const prompt = buildPromptForRecord(selectedRecord);
      await navigator.clipboard.writeText(prompt);
      button.textContent = "Copied";
      setTimeout(() => {
        button.textContent = "Copy Prompt";
      }, 1000);
    });
  });
}

function syncCurrentRecord() {
  if (!currentRecord) {
    setCurrentRecord(latestRecord);
    return;
  }
  const rowId = String(currentRecord?.meta?.rowId ?? "");
  setCurrentRecord(recordsByRowId.get(rowId) || latestRecord);
}

function updateRowSummary() {
  ui.rowCountText.textContent = `Rows loaded: ${recordsByRowId.size}`;
}

function openPromptModal() {
  ui.promptModal.classList.remove("hidden");
  document.body.style.overflow = "hidden";
}

function closePromptModal() {
  ui.promptModal.classList.add("hidden");
  document.body.style.overflow = "";
}

async function fetchRecords() {
  try {
    const response = await fetch("/api/records", { cache: "no-store" });
    if (!response.ok) {
      setStatus("No records yet.");
      return;
    }
    const data = await response.json();
    if (!Array.isArray(data?.records)) {
      setStatus("Records payload was empty.");
      return;
    }

    recordsByRowId.clear();
    data.records.forEach((record) => {
      const rowId = String(record?.meta?.rowId ?? "");
      if (rowId) recordsByRowId.set(rowId, record);
    });

    latestRecord = data.records[data.records.length - 1] || null;
    syncCurrentRecord();
    updateRowSummary();
    renderRowTable();
    setStatus(`Connected. ${data.count || 0} row(s) loaded.`);
  } catch (error) {
    setStatus(`Network error: ${error.message}`);
  }
}

ui.promptLanguage.addEventListener("change", () => {
  renderPrompt();
  renderRowTable();
});
ui.refreshBtn.addEventListener("click", fetchRecords);
ui.openPromptBtn.addEventListener("click", openPromptModal);
ui.closePromptBtn.addEventListener("click", closePromptModal);
ui.promptModal.addEventListener("click", (event) => {
  if (event.target === ui.promptModal) closePromptModal();
});
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && !ui.promptModal.classList.contains("hidden")) {
    closePromptModal();
  }
});
ui.copyBtn.addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(ui.promptOutput.value);
    ui.copyBtn.textContent = "Copied";
    setTimeout(() => {
      ui.copyBtn.textContent = "Copy Prompt";
    }, 1000);
  } catch (_error) {
    ui.copyBtn.textContent = "Copy failed";
    setTimeout(() => {
      ui.copyBtn.textContent = "Copy Prompt";
    }, 1000);
  }
});

renderPrompt();
fetchRecords();
setInterval(fetchRecords, POLL_MS);
