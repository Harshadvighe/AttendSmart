/* ============================================================
   reports.js — Attendance Reports with Filters and CSV Export
   ============================================================ */

let allRecords  = [];
let filtered    = [];
let currentPage = 1;
const PAGE_SIZE = 25;

// ─── Utilities ────────────────────────────────────────────────
function showToast(msg, type = "info") {
  const c = document.getElementById("toastContainer");
  if (!c) return;
  const icons = { success: "✅", error: "❌", warning: "⚠️", info: "ℹ️" };
  const t = document.createElement("div");
  t.className = `toast toast-${type}`;
  t.innerHTML = `<span>${icons[type]}</span><span>${msg}</span>`;
  c.appendChild(t);
  setTimeout(() => { t.classList.add("removing"); setTimeout(() => t.remove(), 260); }, 4000);
}

// ─── Theme ────────────────────────────────────────────────────
(function () {
  const btn  = document.getElementById("themeToggle");
  const root = document.documentElement;
  root.dataset.theme = localStorage.getItem("theme") || "dark";
  if (btn) {
    btn.textContent = root.dataset.theme === "dark" ? "🌙" : "☀️";
    btn.addEventListener("click", () => {
      const next = root.dataset.theme === "dark" ? "light" : "dark";
      root.dataset.theme = next;
      localStorage.setItem("theme", next);
      btn.textContent = next === "dark" ? "🌙" : "☀️";
    });
  }
})();

// ─── Stats / enroll count ─────────────────────────────────────
async function loadStats() {
  try {
    const r = await fetch("/api/stats");
    const d = await r.json();
    const b = document.getElementById("enrolledCount");
    if (b && d.success) b.textContent = `${d.enrolled_students} Students`;
  } catch (e) {}
}
loadStats();

// ─── Load Classes for Filter Dropdown ─────────────────────────
async function loadClassFilter() {
  try {
    const r = await fetch("/api/classes");
    const d = await r.json();
    const sel = document.getElementById("fClass");
    if (!sel || !d.classes) return;
    d.classes.forEach(c => {
      const opt = document.createElement("option");
      opt.value = c.id;
      opt.textContent = `${c.subject} — ${c.section}`;
      sel.appendChild(opt);
    });
  } catch (e) {}
}
loadClassFilter();

// ─── Set Default Date Range (last 30 days) ────────────────────
(function setDefaultDates() {
  const toEl   = document.getElementById("fDateTo");
  const fromEl = document.getElementById("fDateFrom");
  const today  = new Date();
  const from   = new Date(today);
  from.setDate(from.getDate() - 30);
  if (toEl)   toEl.value   = today.toISOString().slice(0, 10);
  if (fromEl) fromEl.value = from.toISOString().slice(0, 10);
})();

// ─── Fetch Records ────────────────────────────────────────────
async function fetchRecords() {
  const dateFrom = document.getElementById("fDateFrom")?.value || "";
  const dateTo   = document.getElementById("fDateTo")?.value   || "";
  const classId  = document.getElementById("fClass")?.value    || "";
  const student  = document.getElementById("fStudent")?.value  || "";

  const params = new URLSearchParams();
  if (dateFrom) params.set("date_from", dateFrom);
  if (dateTo)   params.set("date_to",   dateTo);
  if (classId)  params.set("class_id",  classId);
  if (student)  params.set("student_name", student);

  try {
    const res  = await fetch("/api/attendance/records?" + params.toString());
    const data = await res.json();
    if (!data.success) throw new Error(data.error);
    allRecords  = data.records || [];
    currentPage = 1;
    applyTableFilter();
  } catch (e) {
    showToast("Failed to load records: " + e.message, "error");
  }
}

// ─── Apply In-table Filter (status + search) ─────────────────
function applyTableFilter() {
  const statusFilter = document.getElementById("fStatus")?.value   || "";
  const tableSearch  = (document.getElementById("tableSearch")?.value || "").toLowerCase();

  filtered = allRecords.filter(r => {
    const matchStatus = !statusFilter || r.status === statusFilter;
    const matchSearch = !tableSearch  ||
      (r.name      || "").toLowerCase().includes(tableSearch) ||
      (r.studentId || "").toLowerCase().includes(tableSearch) ||
      (r.subject   || "").toLowerCase().includes(tableSearch) ||
      (r.section   || "").toLowerCase().includes(tableSearch);
    return matchStatus && matchSearch;
  });

  updateSummary(filtered);
  renderTable();
}

document.getElementById("fStatus")?.addEventListener("change", applyTableFilter);
document.getElementById("tableSearch")?.addEventListener("input", applyTableFilter);
document.getElementById("applyFiltersBtn")?.addEventListener("click", fetchRecords);

// ─── Summary Bar ──────────────────────────────────────────────
function updateSummary(records) {
  const total   = records.length;
  const present = records.filter(r => r.status === "present").length;
  const late    = records.filter(r => r.status === "late").length;
  const absent  = records.filter(r => r.status === "absent").length;
  const pct     = total > 0 ? ((present + late) / total * 100).toFixed(1) : "—";

  document.getElementById("sumTotal")   && (document.getElementById("sumTotal").textContent   = total);
  document.getElementById("sumPresent") && (document.getElementById("sumPresent").textContent = present);
  document.getElementById("sumLate")    && (document.getElementById("sumLate").textContent    = late);
  document.getElementById("sumAbsent")  && (document.getElementById("sumAbsent").textContent  = absent);
  document.getElementById("sumPct")     && (document.getElementById("sumPct").textContent     = typeof pct === "number" ? pct + "%" : pct + (pct !== "—" ? "%" : ""));
}

// ─── Table Render ─────────────────────────────────────────────
function renderTable() {
  const tbody  = document.getElementById("reportsBody");
  if (!tbody) return;

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  if (currentPage > totalPages) currentPage = totalPages;

  const start = (currentPage - 1) * PAGE_SIZE;
  const page  = filtered.slice(start, start + PAGE_SIZE);

  const rangeEl = document.getElementById("recordRangeText");
  if (rangeEl) rangeEl.textContent = filtered.length > 0
    ? `(${start + 1}–${Math.min(start + PAGE_SIZE, filtered.length)} of ${filtered.length})`
    : "";

  if (page.length === 0) {
    tbody.innerHTML = `<tr><td colspan="9" class="text-center text-muted" style="padding:3rem;">No records match your filters</td></tr>`;
    renderPagination(0);
    return;
  }

  tbody.innerHTML = page.map(r => {
    const statusBadge = r.status === "present"
      ? `<span class="badge status-present">Present</span>`
      : r.status === "late"
        ? `<span class="badge status-late">Late</span>`
        : `<span class="badge status-absent">Absent</span>`;
    const encDate    = encodeURIComponent(r.date    || "");
    const encClassId = encodeURIComponent(r.classId || "");
    const encName    = encodeURIComponent(r.name    || "");
    return `
    <tr data-date="${r.date}" data-classid="${r.classId}" data-name="${r.name}" data-status="${r.status}">
      <td>${r.date || "—"}</td>
      <td>${r.subject || "—"}</td>
      <td>${r.section || "—"}</td>
      <td><span class="font-semibold">${r.name || "—"}</span></td>
      <td class="text-muted">${r.studentId || "—"}</td>
      <td class="text-muted">${r.rollNo || "—"}</td>
      <td class="status-cell">${statusBadge}</td>
      <td class="text-muted">${r.markedAt || "—"}</td>
      <td>
        <button class="btn btn-ghost btn-sm edit-record-btn"
          style="padding:0.25rem 0.55rem; font-size:0.75rem;"
          data-date="${r.date}" data-classid="${r.classId}"
          data-name="${r.name}" data-status="${r.status}"
          data-subject="${r.subject || ''}" data-section="${r.section || ''}">
          ✏️
        </button>
      </td>
    </tr>`;
  }).join("");

  renderPagination(totalPages);
}

function renderPagination(totalPages) {
  const el = document.getElementById("pagination");
  if (!el) return;
  if (totalPages <= 1) { el.innerHTML = ""; return; }

  const pages = [];
  for (let p = 1; p <= totalPages; p++) {
    if (p === 1 || p === totalPages || Math.abs(p - currentPage) <= 2) {
      pages.push(p);
    } else if (pages[pages.length - 1] !== "…") {
      pages.push("…");
    }
  }

  el.innerHTML = [
    `<button class="page-btn" onclick="goPage(${currentPage - 1})" ${currentPage === 1 ? "disabled" : ""}>‹</button>`,
    ...pages.map(p => p === "…"
      ? `<span style="color:var(--txt-muted);">…</span>`
      : `<button class="page-btn ${p === currentPage ? "active" : ""}" onclick="goPage(${p})">${p}</button>`),
    `<button class="page-btn" onclick="goPage(${currentPage + 1})" ${currentPage === totalPages ? "disabled" : ""}>›</button>`,
  ].join("");
}

window.goPage = function (p) {
  const totalPages = Math.ceil(filtered.length / PAGE_SIZE);
  if (p < 1 || p > totalPages) return;
  currentPage = p;
  renderTable();
  window.scrollTo({ top: 0, behavior: "smooth" });
};

// ─── CSV Export ───────────────────────────────────────────────
document.getElementById("exportBtn")?.addEventListener("click", () => {
  const dateFrom = document.getElementById("fDateFrom")?.value || "";
  const dateTo   = document.getElementById("fDateTo")?.value   || "";
  const classId  = document.getElementById("fClass")?.value    || "";
  const student  = document.getElementById("fStudent")?.value  || "";

  const params = new URLSearchParams();
  if (dateFrom) params.set("date_from", dateFrom);
  if (dateTo)   params.set("date_to",   dateTo);
  if (classId)  params.set("class_id",  classId);
  if (student)  params.set("student_name", student);

  window.location.href = "/api/attendance/export?" + params.toString();
  showToast("CSV download started.", "success");
});

// ─── URL Param Pre-fill ───────────────────────────────────────
(function checkUrlParams() {
  const p = new URLSearchParams(window.location.search);
  if (p.get("class_id")) {
    const el = document.getElementById("fClass");
    if (el) el.value = p.get("class_id");
  }
})();

// ─── Edit Modal Logic ─────────────────────────────────────────
let _editData = null;

document.getElementById("reportsBody")?.addEventListener("click", (e) => {
  const btn = e.target.closest(".edit-record-btn");
  if (!btn) return;

  _editData = {
    date: btn.dataset.date,
    classId: btn.dataset.classid,
    name: btn.dataset.name,
    status: btn.dataset.status
  };

  document.getElementById("editModalName").textContent = btn.dataset.name;
  document.getElementById("editModalMeta").textContent = `${btn.dataset.date} · ${btn.dataset.subject} — ${btn.dataset.section}`;

  // Highlight current status
  document.querySelectorAll(".status-pick-btn").forEach(b => {
    if (b.dataset.status === _editData.status) {
      b.style.opacity = "1";
      b.style.transform = "scale(1.05)";
      b.style.fontWeight = "bold";
    } else {
      b.style.opacity = "0.6";
      b.style.transform = "scale(1)";
      b.style.fontWeight = "normal";
    }
  });

  document.getElementById("editModal").classList.remove("hidden");
});

document.querySelectorAll(".status-pick-btn").forEach(btn => {
  btn.addEventListener("click", () => {
    _editData.status = btn.dataset.status;
    document.querySelectorAll(".status-pick-btn").forEach(b => {
      b.style.opacity = "0.6";
      b.style.transform = "scale(1)";
      b.style.fontWeight = "normal";
    });
    btn.style.opacity = "1";
    btn.style.transform = "scale(1.05)";
    btn.style.fontWeight = "bold";
  });
});

document.getElementById("closeEditModalBtn")?.addEventListener("click", () => {
  document.getElementById("editModal").classList.add("hidden");
  _editData = null;
});

document.getElementById("saveEditRecordBtn")?.addEventListener("click", async () => {
  if (!_editData) return;
  const btn = document.getElementById("saveEditRecordBtn");
  btn.disabled = true;
  btn.textContent = "⏳ Saving...";

  try {
    const res = await fetch("/api/attendance/record", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        date: _editData.date,
        classId: _editData.classId,
        name: _editData.name,
        status: _editData.status
      })
    });
    const data = await res.json();
    if (!data.success) throw new Error(data.error);

    showToast(data.message, "success");
    document.getElementById("editModal").classList.add("hidden");
    
    // Update local data and re-render without full fetch
    const recIndex = allRecords.findIndex(r => r.date === _editData.date && r.classId === _editData.classId && r.name === _editData.name);
    if (recIndex > -1) {
      allRecords[recIndex].status = _editData.status;
      // Also update markedAt if needed, here we just refresh
      applyTableFilter();
    }
  } catch (e) {
    showToast("Failed to edit: " + e.message, "error");
  } finally {
    btn.disabled = false;
    btn.textContent = "💾 Save Change";
    _editData = null;
  }
});

// ─── Init ─────────────────────────────────────────────────────
fetchRecords();
