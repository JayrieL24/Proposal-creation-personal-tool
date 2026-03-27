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
const TRANSLATION_TOGGLE_FIELDS = new Set(["Industry", "Erik's call notes", "Info for Coders"]);
const POLL_MS = 3000;
const API_BASE = "https://proposal-creation-personal-tool.onrender.com";

function makeDefaultColumns() {
  const columns = [
    { id: "select", label: "Use", type: "select" },
    { id: "row", label: "Row", type: "meta" }
  ];

  for (const field of FIELDS) {
    columns.push({ id: `${field}_sk`, label: `${field} (SK)`, type: "field", field, lang: "sk" });
  }

  columns.push({ id: "updated", label: "Updated", type: "meta" });
  return columns;
}

const DEFAULT_COLUMNS = makeDefaultColumns();

const ui = {
  statusText: document.getElementById("statusText"),
  rowText: document.getElementById("rowText"),
  updatedText: document.getElementById("updatedText"),
  rowTableHead: document.getElementById("rowTableHead"),
  rowTableBody: document.getElementById("rowTableBody"),
  rowCountText: document.getElementById("rowCountText"),
  promptOutput: document.getElementById("promptOutput"),
  copyBtn: document.getElementById("copyBtn"),
  resetPromptBtn: document.getElementById("resetPromptBtn"),
  undoResetBtn: document.getElementById("undoResetBtn"),
  refreshBtn: document.getElementById("refreshBtn"),
  openPromptBtn: document.getElementById("openPromptBtn"),
  closePromptBtn: document.getElementById("closePromptBtn"),
  promptModal: document.getElementById("promptModal"),
  translationCard: document.getElementById("translationCard"),
  translationCardTitle: document.getElementById("translationCardTitle"),
  translationSkValue: document.getElementById("translationSkValue"),
  translationEnValue: document.getElementById("translationEnValue"),
  closeTranslationCardBtn: document.getElementById("closeTranslationCardBtn")
};

let currentRecord = null;
let latestRecord = null;
let isPromptDirty = false;
let lastPromptBeforeReset = null;
let hasExplicitNoSelection = false;
const recordsByRowId = new Map();
const includeMap = new Map();
const columns = DEFAULT_COLUMNS;

for (const field of FIELDS) {
  includeMap.set(field, !EXCLUDED_BY_DEFAULT.has(field));
}

function escapeHtml(input) {
  return String(input)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function linkifyText(text) {
  if (!text || text === "Empty") return text;
  const urlRegex = /(https?:\/\/[^\s]+)/g;
  const escaped = escapeHtml(text);
  return escaped.replace(urlRegex, '<a href="$1" target="_blank" rel="noopener noreferrer">$1</a>');
}

function displayValue(value) {
  if (value === null || value === undefined || value === "") {
    return '<span class="value-empty">Empty</span>';
  }
  return linkifyText(escapeHtml(value));
}

function getSkValue(field, record = currentRecord) {
  return record?.[field] ?? null;
}

function getEnValue(field, record = currentRecord) {
  return record?.translated?.[field] ?? null;
}

function templateValue(value) {
  return value === null || value === undefined || value === "" ? "" : String(value);
}

function getCompanyDisplay(record) {
  const company = getSkValue("Company", record);
  if (company) return company;
  const first = getSkValue("First", record);
  const last = getSkValue("Last", record);
  const fallback = [first, last].filter(Boolean).join(" ").trim();
  return fallback || null;
}

function buildPromptTemplate(record) {
  const ownerName = [templateValue(getSkValue("First", record)), templateValue(getSkValue("Last", record))]
    .filter(Boolean)
    .join(" ")
    .trim();
  const businessName = ownerName || templateValue(getSkValue("Company", record));
  const industry = templateValue(getSkValue("Industry", record));
  const location = templateValue(getSkValue("City", record));
  const phone = templateValue(getSkValue("Phone", record));
  const email = templateValue(getSkValue("Email", record));
  const images = templateValue(getSkValue("Info", record));
  const notes = [templateValue(getSkValue("Erik's call notes", record)), templateValue(getSkValue("Info for Coders", record))]
    .filter(Boolean)
    .join(" | ");

  return `Today we are going to create a new proposal website. Read the website-structure-rules(1).md and follow it exactly. Here is all the information:

Business name: ${businessName}
Industry: ${industry}
Location (Can you add an embedded google map of the address of the business): ${location}
Services they offer:
IČO:

Contact info:
- Phone: ${phone}
- Email: ${email}
- Address (Can you add an embedded google map of the address of the business if empty disregard):
- Working hours:

Images (paste any URLs — bazos, facebook, google, whatever they have AND PLEASE ALIGN THE IMAGES BASE ON THE SERVICE): ${images}

Brands/materials they work with (if any):

Extra notes (years in business, selling points, anything special): ${notes}

Create the full website (Limit gallery to 4 cards & featured services to 4 contents) — content.json, index.html, style.css, script.js. Use GSAP + ScrollTrigger for animations.`;
}

function setStatus(text) {
  ui.statusText.textContent = text;
}

function renderPrompt() {
  if (isPromptDirty) return;
  ui.promptOutput.value = buildPromptTemplate(currentRecord);
}

function setCurrentRecord(record) {
  currentRecord = record;
  const meta = record?.meta || {};
  ui.rowText.textContent = meta.rowId ? String(meta.rowId) : "-";
  ui.updatedText.textContent = meta.timestamp || "-";
  isPromptDirty = false;
  lastPromptBeforeReset = null;
  ui.undoResetBtn.classList.add("hidden");
  renderPrompt();
}

function openTranslationCard(field, anchorElement) {
  if (!currentRecord) return;
  const rowId = currentRecord?.meta?.rowId || "-";
  const sk = getSkValue(field, currentRecord) || "Empty";
  const en = getEnValue(field, currentRecord) || "Empty";
  ui.translationCardTitle.textContent = `${field} Translation (Row ${rowId})`;
  ui.translationSkValue.innerHTML = linkifyText(String(sk));
  ui.translationEnValue.innerHTML = linkifyText(String(en));
  ui.translationCard.classList.remove("hidden");

  const anchorRect = anchorElement.getBoundingClientRect();
  const cardRect = ui.translationCard.getBoundingClientRect();
  const margin = 10;
  
  // Calculate horizontal position (centered on button, but keep within viewport)
  const maxLeft = window.innerWidth - cardRect.width - margin;
  let left = anchorRect.left + (anchorRect.width / 2) - (cardRect.width / 2);
  if (left > maxLeft) left = maxLeft;
  if (left < margin) left = margin;

  // Position above the button
  let top = anchorRect.top - cardRect.height - margin;
  
  // If not enough space above, position below
  if (top < margin) {
    top = anchorRect.bottom + margin;
  }

  ui.translationCard.style.left = `${left}px`;
  ui.translationCard.style.top = `${top}px`;
}

function closeTranslationCard() {
  ui.translationCard.classList.add("hidden");
}

function columnCellContent(column, record) {
  if (column.id === "select") {
    const rowId = String(record?.meta?.rowId ?? "");
    const isSelected = String(currentRecord?.meta?.rowId ?? "") === rowId;
    return `<input type="checkbox" data-select-row-id="${escapeHtml(rowId)}" ${isSelected ? "checked" : ""} />`;
  }
  if (column.id === "row") return displayValue(record?.meta?.rowId ?? "-");
  if (column.id === "updated") return displayValue(record?.meta?.timestamp ?? "-");
  if (column.field === "Company") return displayValue(getCompanyDisplay(record));
  return displayValue(getSkValue(column.field, record));
}

function renderHeader() {
  ui.rowTableHead.innerHTML = `
    <tr>
      ${columns.map((column) => `
        <th data-col-id="${escapeHtml(column.id)}">
          <div class="th-inner">
            <span>${escapeHtml(column.label)}</span>
            ${column.type === "field" && TRANSLATION_TOGGLE_FIELDS.has(column.field)
              ? `<button type="button" class="translate-icon-btn" data-translate-field="${escapeHtml(column.field)}" title="Show translation">EN</button>`
              : ""}
          </div>
        </th>
      `).join("")}
    </tr>
  `;

  ui.rowTableHead.querySelectorAll("button[data-translate-field]").forEach((button) => {
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      const field = event.currentTarget.dataset.translateField;
      openTranslationCard(field, event.currentTarget);
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
        if (String(currentRecord?.meta?.rowId ?? "") === rowId) {
          currentRecord = null;
          hasExplicitNoSelection = true;
          ui.rowText.textContent = "-";
          ui.updatedText.textContent = "-";
        }
        renderRowTable();
        return;
      }
      hasExplicitNoSelection = false;
      setCurrentRecord(selectedRecord);
      renderRowTable();
    });
  });
}

function syncCurrentRecord() {
  if (hasExplicitNoSelection) {
    currentRecord = null;
    ui.rowText.textContent = "-";
    ui.updatedText.textContent = "-";
    return;
  }

  if (!currentRecord) {
    setCurrentRecord(latestRecord);
    return;
  }
  const rowId = String(currentRecord?.meta?.rowId ?? "");
  const updatedRecord = recordsByRowId.get(rowId) || latestRecord;
  
  // Update currentRecord without resetting the prompt if user is editing
  currentRecord = updatedRecord;
  const meta = updatedRecord?.meta || {};
  ui.rowText.textContent = meta.rowId ? String(meta.rowId) : "-";
  ui.updatedText.textContent = meta.timestamp || "-";
  
  // Only re-render prompt if user hasn't made manual edits
  if (!isPromptDirty) {
    renderPrompt();
  }
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

async function loadRecordsFromResponse(response) {
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
}

async function fetchRecords() {
  try {
    const response = await fetch(`${API_BASE}/api/records`, { cache: "no-store" });
    await loadRecordsFromResponse(response);
  } catch (error) {
    setStatus(`Network error: ${error.message}`);
  }
}

async function refreshNow() {
  ui.refreshBtn.disabled = true;
  const previousText = ui.refreshBtn.textContent;
  ui.refreshBtn.textContent = "Refreshing...";
  setStatus("Refreshing data...");
  const cacheBustUrl = `${API_BASE}/api/records?t=${Date.now()}`;

  try {
    const response = await fetch(cacheBustUrl, { cache: "no-store" });
    await loadRecordsFromResponse(response);
  } catch (error) {
    setStatus(`Refresh error: ${error.message}`);
  } finally {
    ui.refreshBtn.disabled = false;
    ui.refreshBtn.textContent = previousText;
  }
}

document.querySelectorAll("button[data-prompt-translate-field]").forEach((button) => {
  button.addEventListener("click", (event) => {
    const field = event.currentTarget.dataset.promptTranslateField;
    openTranslationCard(field, event.currentTarget);
  });
});

ui.promptOutput.addEventListener("input", () => {
  isPromptDirty = true;
});
ui.resetPromptBtn.addEventListener("click", () => {
  lastPromptBeforeReset = ui.promptOutput.value;
  isPromptDirty = false;
  ui.promptOutput.value = buildPromptTemplate(currentRecord);
  ui.undoResetBtn.classList.remove("hidden");
});
ui.undoResetBtn.addEventListener("click", () => {
  if (lastPromptBeforeReset === null) return;
  ui.promptOutput.value = lastPromptBeforeReset;
  isPromptDirty = true;
  lastPromptBeforeReset = null;
  ui.undoResetBtn.classList.add("hidden");
});
ui.refreshBtn.addEventListener("click", refreshNow);
ui.openPromptBtn.addEventListener("click", openPromptModal);
ui.closePromptBtn.addEventListener("click", closePromptModal);
ui.closeTranslationCardBtn.addEventListener("click", closeTranslationCard);
ui.promptModal.addEventListener("click", (event) => {
  if (event.target === ui.promptModal) closePromptModal();
});
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && !ui.promptModal.classList.contains("hidden")) closePromptModal();
  if (event.key === "Escape" && !ui.translationCard.classList.contains("hidden")) closeTranslationCard();
});
ui.copyBtn.addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(ui.promptOutput.value);
    ui.copyBtn.textContent = "✓";
    setTimeout(() => {
      ui.copyBtn.innerHTML = "&#128203;";
    }, 900);
  } catch (_error) {
    ui.copyBtn.textContent = "!";
    setTimeout(() => {
      ui.copyBtn.innerHTML = "&#128203;";
    }, 900);
  }
});

renderPrompt();
fetchRecords();
setInterval(fetchRecords, POLL_MS);
