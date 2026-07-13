/* ============================================================
   students.js — Student Directory
   ============================================================ */

let allStudents = [];

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

// ─── Load & Render Students ───────────────────────────────────
async function loadStudents() {
  const grid = document.getElementById("studentsGrid");
  try {
    const res  = await fetch("/api/students");
    const data = await res.json();
    if (!data.success) throw new Error(data.error);

    allStudents = data.students || [];

    // Populate filter dropdowns
    populateFilters(allStudents);
    renderStudents(allStudents);

    const txt = document.getElementById("studentCountText");
    if (txt) txt.textContent = `${allStudents.length} students enrolled`;

    const badge = document.getElementById("enrolledCount");
    if (badge) badge.textContent = `${allStudents.length} Students`;

  } catch (e) {
    if (grid) grid.innerHTML = `<div style="grid-column:1/-1;"><div class="empty-state"><div class="empty-icon">❌</div><div class="empty-title">Failed to load students</div><div class="empty-sub">${e.message}</div></div></div>`;
    showToast("Failed to load students: " + e.message, "error");
  }
}

function attBadgeClass(pct) {
  if (pct >= 75) return "att-high";
  if (pct >= 50) return "att-medium";
  if (pct > 0)   return "att-low";
  return "att-none";
}

function renderStudents(students) {
  const grid = document.getElementById("studentsGrid");
  if (!grid) return;

  if (students.length === 0) {
    grid.innerHTML = `<div style="grid-column:1/-1;"><div class="empty-state"><div class="empty-icon">👥</div><div class="empty-title">No students found</div><div class="empty-sub">Try different filters or enroll students first</div><a href="/register" class="btn btn-primary btn-sm" style="margin-top:1rem;">➕ Enroll Student</a></div></div>`;
    return;
  }

  grid.innerHTML = students.map(s => {
    const pct     = s.attendancePct || 0;
    const pctLbl  = s.attendanceTotal > 0 ? `${pct}%` : "N/A";
    const bCls    = attBadgeClass(pct);
    return `
    <div class="student-card glass-card" style="padding:0; cursor:pointer;" onclick="openDetail('${s.name}')">
      <div class="student-photo-wrap">
        <img
          src="/api/students/${encodeURIComponent(s.name)}/photo"
          alt="${s.name}"
          onerror="this.src='data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 100 100%22><rect width=%22100%22 height=%22100%22 fill=%22%230a1628%22/><text y=%22.9em%22 font-size=%2250%22 x=%2225%22>🧑</text></svg>'"
        />
        <div class="student-att-badge ${bCls}">${pctLbl}</div>
      </div>
      <div class="student-card-body">
        <div class="student-card-name">${s.name}</div>
        <div class="student-card-meta">${s.studentId || ""} ${s.section ? "· " + s.section : ""}</div>
        <div class="student-card-meta" style="margin-top:2px;">${s.department || ""} ${s.year ? "· " + s.year : ""}</div>
      </div>
    </div>`;
  }).join("");
}

// ─── Filters ──────────────────────────────────────────────────
function populateFilters(students) {
  const sections = [...new Set(students.map(s => s.section).filter(Boolean))].sort();
  const depts    = [...new Set(students.map(s => s.department).filter(Boolean))].sort();

  const fSec  = document.getElementById("filterSection");
  const fDept = document.getElementById("filterDept");

  if (fSec) {
    fSec.innerHTML = '<option value="">All Sections</option>' +
      sections.map(v => `<option value="${v}">${v}</option>`).join("");
  }
  if (fDept) {
    fDept.innerHTML = '<option value="">All Departments</option>' +
      depts.map(v => `<option value="${v}">${v}</option>`).join("");
  }
}

function applyFilters() {
  const q    = (document.getElementById("searchInput")?.value || "").toLowerCase();
  const sec  = document.getElementById("filterSection")?.value || "";
  const dept = document.getElementById("filterDept")?.value || "";
  const sort = document.getElementById("sortBy")?.value || "name";

  let filtered = allStudents.filter(s => {
    const matchQ = !q ||
      s.name.toLowerCase().includes(q) ||
      (s.studentId || "").toLowerCase().includes(q) ||
      (s.rollNo    || "").toLowerCase().includes(q);
    const matchSec  = !sec  || s.section    === sec;
    const matchDept = !dept || s.department === dept;
    return matchQ && matchSec && matchDept;
  });

  // Sort
  filtered.sort((a, b) => {
    if (sort === "name")     return a.name.localeCompare(b.name);
    if (sort === "rollNo")   return (a.rollNo || "").localeCompare(b.rollNo || "");
    if (sort === "att_desc") return (b.attendancePct || 0) - (a.attendancePct || 0);
    if (sort === "att_asc")  return (a.attendancePct || 0) - (b.attendancePct || 0);
    return 0;
  });

  renderStudents(filtered);
  const txt = document.getElementById("studentCountText");
  if (txt) txt.textContent = `${filtered.length} of ${allStudents.length} students`;
}

["searchInput", "filterSection", "filterDept", "sortBy"].forEach(id => {
  document.getElementById(id)?.addEventListener("input", applyFilters);
  document.getElementById(id)?.addEventListener("change", applyFilters);
});

// ─── Detail Modal ─────────────────────────────────────────────
let _currentStudent = null;

window.openDetail = function (name) {
  const s = allStudents.find(x => x.name === name);
  if (!s) return;
  _currentStudent = s;

  const modal = document.getElementById("detailModal");
  modal?.classList.remove("hidden");
  document.getElementById("viewMode")?.classList.remove("hidden");
  document.getElementById("editMode")?.classList.add("hidden");

  // Photo
  const photo = document.getElementById("detailPhoto");
  if (photo) {
    photo.src = `/api/students/${encodeURIComponent(name)}/photo`;
    photo.onerror = () => { photo.src = 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect width="100" height="100" fill="%230a1628"/><text y=".9em" font-size="50" x="25">🧑</text></svg>'; };
  }
  document.getElementById("detailName")?.setText ? null : (() => {
    const el = document.getElementById("detailName");
    if (el) el.textContent = s.name;
  })();
  document.getElementById("detailName")  && (document.getElementById("detailName").textContent  = s.name);
  document.getElementById("detailId")    && (document.getElementById("detailId").textContent    = s.studentId ? `ID: ${s.studentId}` : "");

  // Attendance mini grid
  const attGrid = document.getElementById("detailAttGrid");
  if (attGrid) {
    const pct = s.attendancePct || 0;
    attGrid.innerHTML = `
      <div class="att-mini-item"><div class="att-mini-val" style="color:var(--clr-success);">${pct}%</div><div class="att-mini-lbl">Attendance</div></div>
      <div class="att-mini-item"><div class="att-mini-val">${s.attendanceTotal || 0}</div><div class="att-mini-lbl">Sessions</div></div>
      <div class="att-mini-item"><div class="att-mini-val">${s.div || s.section || "—"}</div><div class="att-mini-lbl">Div</div></div>`;
  }

  // Fields
  const fields = document.getElementById("detailFields");
  if (fields) {
    const rows = [
      ["Roll No",     s.rollNo      || "—"],
      ["Department",  s.department  || "—"],
      ["Class",       s.class       || s.year || "—"],
      ["Email",       s.email       || "—"],
      ["Phone",       s.phone       || "—"],
      ["Enrolled",    s.registeredAt || "—"],
    ];
    fields.innerHTML = rows.map(([l, v]) => `
      <div class="detail-field">
        <span class="detail-field-label">${l}</span>
        <span>${v}</span>
      </div>`).join("");
  }
};

document.getElementById("closeDetailBtn")?.addEventListener("click", () => {
  document.getElementById("detailModal")?.classList.add("hidden");
});
document.getElementById("detailModal")?.addEventListener("click", e => {
  if (e.target.id === "detailModal") document.getElementById("detailModal").classList.add("hidden");
});

// ─── Edit Mode ────────────────────────────────────────────────
document.getElementById("editStudentBtn")?.addEventListener("click", () => {
  if (!_currentStudent) return;
  document.getElementById("viewMode")?.classList.add("hidden");
  document.getElementById("editMode")?.classList.remove("hidden");
  const s = _currentStudent;
  document.getElementById("editStudentId") && (document.getElementById("editStudentId").value = s.studentId || "");
  document.getElementById("editRollNo")    && (document.getElementById("editRollNo").value    = s.rollNo    || "");
  document.getElementById("editSection")   && (document.getElementById("editSection").value   = s.div || s.section || "");
  document.getElementById("editDept")      && (document.getElementById("editDept").value      = s.department|| "");
  document.getElementById("editYear")      && (document.getElementById("editYear").value      = s.class || s.year || "");
  document.getElementById("editEmail")     && (document.getElementById("editEmail").value     = s.email     || "");
  document.getElementById("editPhone")     && (document.getElementById("editPhone").value     = s.phone     || "");
});

document.getElementById("cancelEditBtn")?.addEventListener("click", () => {
  document.getElementById("editMode")?.classList.add("hidden");
  document.getElementById("viewMode")?.classList.remove("hidden");
});

document.getElementById("saveEditBtn")?.addEventListener("click", async () => {
  if (!_currentStudent) return;
  const payload = {
    studentId:  document.getElementById("editStudentId")?.value.trim(),
    rollNo:     document.getElementById("editRollNo")?.value.trim(),
    class:      document.getElementById("editYear")?.value.trim(),
    div:        document.getElementById("editSection")?.value.trim(),
    department: document.getElementById("editDept")?.value.trim(),
    email:      document.getElementById("editEmail")?.value.trim(),
    phone:      document.getElementById("editPhone")?.value.trim(),
  };
  try {
    const res  = await fetch(`/api/students/${encodeURIComponent(_currentStudent.name)}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (!data.success) { showToast(data.error, "error"); return; }
    showToast("Profile updated.", "success");
    document.getElementById("detailModal")?.classList.add("hidden");
    await loadStudents();
  } catch (e) {
    showToast("Update failed: " + e.message, "error");
  }
});

// ─── Delete ───────────────────────────────────────────────────
document.getElementById("deleteStudentBtn")?.addEventListener("click", async () => {
  if (!_currentStudent) return;
  if (!confirm(`Delete ${_currentStudent.name}? This cannot be undone.`)) return;
  try {
    const res  = await fetch(`/api/students/${encodeURIComponent(_currentStudent.name)}`, { method: "DELETE" });
    const data = await res.json();
    if (!data.success) { showToast(data.error, "error"); return; }
    showToast(`${_currentStudent.name} removed.`, "success");
    document.getElementById("detailModal")?.classList.add("hidden");
    _currentStudent = null;
    await loadStudents();
  } catch (e) {
    showToast("Delete failed: " + e.message, "error");
  }
});

// ─── Init ─────────────────────────────────────────────────────
loadStudents();
