/* ============================================================
   attend.js — Live Attendance Marking via Face Recognition
   ============================================================ */

// ─── State ────────────────────────────────────────────────────
let stream        = null;
let captureTimer  = null;
let sessionActive = false;
let sessionData   = null;
let currentClassId= new URLSearchParams(window.location.search).get("class_id") || null;

const CAPTURE_INTERVAL_MS = 700; // how often to send frames (ms)

// ─── DOM Refs ─────────────────────────────────────────────────
const video        = document.getElementById("webcamVideo");
const canvas       = document.getElementById("webcamCanvas");
const ctx          = canvas ? canvas.getContext("2d") : null;
const scanLine     = document.getElementById("scanLine");
const startCamBtn  = document.getElementById("startCamBtn");
const stopCamBtn   = document.getElementById("stopCamBtn");
const liveBadge    = document.getElementById("liveBadge");
const statusText   = document.getElementById("statusText");

// Session
const newSessionBtn  = document.getElementById("newSessionBtn");
const endSessionBtn  = document.getElementById("endSessionBtn");
const startSessionBtn= document.getElementById("startSessionBtn");
const cancelModalBtn = document.getElementById("cancelModalBtn");
const sessionModal   = document.getElementById("sessionModal");
const sessionBanner  = document.getElementById("sessionBanner");
const sessionLabel   = document.getElementById("sessionLabel");
const sessionMeta    = document.getElementById("sessionMeta");
const sessionDot     = document.getElementById("sessionDot");

// Recognition card
const recCard      = document.getElementById("recognitionCard");
const stateIdle    = document.getElementById("stateIdle");
const stateRec     = document.getElementById("stateRecognized");
const stateUnknown = document.getElementById("stateUnknown");
const recAvatar    = document.getElementById("recAvatar");
const recName      = document.getElementById("recName");
const recStudentId = document.getElementById("recStudentId");
const recStatusBadge=document.getElementById("recStatusBadge");
const recMarkedAt  = document.getElementById("recMarkedAt");
const confBar      = document.getElementById("confidenceBar");
const confPct      = document.getElementById("confidencePct");
const confDisplay  = document.getElementById("confDisplay");

// Status dots
const camDot  = document.getElementById("camDot");
const faceDot = document.getElementById("faceDot");
const recDot  = document.getElementById("recDot");

// Roll
const rollBody   = document.getElementById("rollBody");
const rollSearch = document.getElementById("rollSearch");
const cntPresent = document.getElementById("cntPresent");
const cntAbsent  = document.getElementById("cntAbsent");
const cntLate    = document.getElementById("cntLate");

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

function setDot(el, state) {
  // state: '' | 'active' | 'pulse'
  if (!el) return;
  el.className = "status-dot" + (state ? " " + state : "");
}

// ─── Theme ────────────────────────────────────────────────────
(function () {
  const btn  = document.getElementById("themeToggle");
  const root = document.documentElement;
  const saved = localStorage.getItem("theme") || "dark";
  root.dataset.theme = saved;
  if (btn) {
    btn.textContent = saved === "dark" ? "🌙" : "☀️";
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

// ─── Session Modal ─────────────────────────────────────────────
if (newSessionBtn) {
  newSessionBtn.addEventListener("click", async () => {
    // Load saved classes for quick-pick
    try {
      const r = await fetch("/api/classes");
      const d = await r.json();
      const selEl  = document.getElementById("savedClassesSel");
      if (d.classes && d.classes.length > 0 && selEl) {
        selEl.innerHTML = '<option value="">— choose class —</option>' +
          d.classes.map(c => `<option value="${c.id}" data-subject="${c.subject}" data-class="${c.class || ''}" data-div="${c.div || ''}">${c.subject} — Class: ${c.class || ''}, Div: ${c.div || ''}</option>`).join("");
        
        selEl.addEventListener("change", () => {
          const opt = selEl.selectedOptions[0];
          const previewCard = document.getElementById("classPreviewCard");
          if (!opt.value) {
            if (previewCard) previewCard.style.display = "none";
            return;
          }
          document.getElementById("selSubject").value = opt.dataset.subject || "";
          document.getElementById("selClass").value = opt.dataset.class || "";
          document.getElementById("selSection").value = opt.dataset.div || "";
          
          if (previewCard) {
            document.getElementById("previewSubject").textContent = opt.dataset.subject || "—";
            document.getElementById("previewClass").textContent = opt.dataset.class || "—";
            document.getElementById("previewDiv").textContent = opt.dataset.div || "—";
            previewCard.style.display = "block";
          }
        });
      } else if (selEl) {
        selEl.innerHTML = '<option value="">No assigned classes found</option>';
      }
    } catch (e) {}
    sessionModal.classList.remove("hidden");
  });
}
if (cancelModalBtn) cancelModalBtn.addEventListener("click", () => sessionModal.classList.add("hidden"));
sessionModal?.addEventListener("click", e => { if (e.target === sessionModal) sessionModal.classList.add("hidden"); });

if (startSessionBtn) {
  startSessionBtn.addEventListener("click", async () => {
    const subject = document.getElementById("selSubject").value.trim();
    const className = document.getElementById("selClass").value.trim();
    const division = document.getElementById("selSection").value.trim();
    const teacher = document.getElementById("selTeacher").value.trim();
    const passcode = document.getElementById("selPasscode").value.trim();
    const late    = parseInt(document.getElementById("selLate").value) || 10;

    if (!subject || !className || !division || !passcode) {
      showToast("Subject, Class, Division, and Passcode are required.", "warning");
      return;
    }

    const classId = document.getElementById("savedClassesSel").value.trim();
    if (!classId) {
      showToast("Please select a class.", "warning");
      return;
    }

    try {
      const res = await fetch("/api/attendance/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ classId, subject, class: className, div: division, teacher, passcode, lateAfterMinutes: late }),
      });
      const data = await res.json();
      if (!data.success) { showToast(data.error, "error"); return; }
      sessionModal.classList.add("hidden");
      sessionData   = data.session;
      sessionActive = true;
      currentClassId= classId;
      window.history.replaceState({}, "", `/attend?class_id=${classId}`);
      updateSessionBanner();
      renderRoll(data.session.records || []);
      showToast(`Session started: ${subject} — ${section}`, "success");
    } catch (e) {
      showToast("Failed to start session: " + e.message, "error");
    }
  });
}

// ─── End Session ──────────────────────────────────────────────
if (endSessionBtn) {
  endSessionBtn.addEventListener("click", async () => {
    if (!confirm("End the current attendance session? All absent students will be finalised.")) return;
    try {
      const res  = await fetch("/api/attendance/end", { 
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ classId: currentClassId })
      });
      const data = await res.json();
      if (!data.success) { showToast(data.error, "error"); return; }
      sessionActive = false;
      sessionData   = null;
      updateSessionBanner();
      rollBody.innerHTML = `<tr><td colspan="5" class="text-center text-muted" style="padding:2rem;">Session ended</td></tr>`;
      resetCounters();
      showToast(data.message, "success");
    } catch (e) {
      showToast("Failed to end session.", "error");
    }
  });
}

function updateSessionBanner() {
  if (sessionActive && sessionData) {
    sessionBanner.classList.add("active");
    sessionDot.classList.add("active");
    sessionLabel.textContent = `${sessionData.subject} — ${sessionData.section}`;
    sessionMeta.innerHTML  = `Teacher: ${sessionData.teacher || "—"} &middot; Started ${sessionData.startTime} &middot; Passcode: <span class="badge badge-neutral" style="font-size: 0.85em; font-family: monospace; font-weight: 700; color: var(--txt);">${sessionData.passcode || "—"}</span>`;
    newSessionBtn.classList.add("hidden");

    // Only show End Session button to the teacher who started it or admin
    const isOwner = (typeof CURRENT_USER_ROLE !== 'undefined' && CURRENT_USER_ROLE === "admin") || 
                    (sessionData.teacher && typeof CURRENT_USER_NAME !== 'undefined' && sessionData.teacher.trim().toLowerCase() === CURRENT_USER_NAME.trim().toLowerCase());
    if (isOwner) {
      endSessionBtn.classList.remove("hidden");
    } else {
      endSessionBtn.classList.add("hidden");
    }
  } else {
    sessionBanner.classList.remove("active");
    sessionDot.className = "status-dot";
    sessionLabel.textContent = "No Active Session";
    sessionMeta.textContent  = "Start a session to begin marking attendance";
    newSessionBtn.classList.remove("hidden");
    endSessionBtn.classList.add("hidden");
  }
}

// ─── Camera ───────────────────────────────────────────────────
if (startCamBtn) startCamBtn.addEventListener("click", startCamera);
if (stopCamBtn)  stopCamBtn.addEventListener("click", stopCamera);

async function startCamera() {
  try {
    stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "user", width: 640, height: 480 }, audio: false });
    video.srcObject = stream;
    setDot(camDot, "active");
    startCamBtn.classList.add("hidden");
    stopCamBtn.classList.remove("hidden");
    if (liveBadge) liveBadge.classList.remove("hidden");
    if (scanLine)  scanLine.classList.add("active");
    if (statusText) statusText.textContent = "Camera running";
    captureTimer = setInterval(captureAndSend, CAPTURE_INTERVAL_MS);
  } catch (e) {
    showToast("Camera error: " + e.message, "error");
    if (statusText) statusText.textContent = "Camera failed";
  }
}

function stopCamera() {
  if (stream) { stream.getTracks().forEach(t => t.stop()); stream = null; }
  if (captureTimer) { clearInterval(captureTimer); captureTimer = null; }
  video.srcObject = null;
  setDot(camDot, "");
  setDot(faceDot, "");
  setDot(recDot, "");
  startCamBtn.classList.remove("hidden");
  stopCamBtn.classList.add("hidden");
  if (liveBadge) liveBadge.classList.add("hidden");
  if (scanLine)  scanLine.classList.remove("active");
  if (statusText) statusText.textContent = "Camera stopped";
  showIdle();
}

// ─── Frame Capture & Send ─────────────────────────────────────
let _sending = false;
async function captureAndSend() {
  if (_sending || !video.videoWidth) return;
  _sending = true;
  try {
    canvas.width  = video.videoWidth;
    canvas.height = video.videoHeight;
    ctx.drawImage(video, 0, 0);
    const b64 = canvas.toDataURL("image/jpeg", 0.7);

    const endpoint = sessionActive ? "/api/attendance/mark" : "/api/recognize";
    const res  = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ image: b64, classId: currentClassId }),
    });
    const data = await res.json();

    if (!data.success) { _sending = false; return; }

    handleResult(data);
  } catch (e) {
    console.warn("Frame error:", e);
  } finally {
    _sending = false;
  }
}

// ─── Handle Recognition Result ────────────────────────────────
let _lastShownName = null;
let _lastShownTs   = 0;

function handleResult(data) {
  const COOLDOWN = 3000; // ms before reshowing same student card

  if (!data.face_detected) {
    setDot(faceDot, "");
    setDot(recDot, "");
    if (confDisplay) confDisplay.textContent = "—";
    showIdle();
    return;
  }

  setDot(faceDot, "active");

  if (!data.recognized) {
    setDot(recDot, "");
    if (confDisplay) confDisplay.textContent = `${data.confidence || 0}%`;
    showUnknown();
    return;
  }

  setDot(recDot, "pulse");
  const conf = data.confidence || 0;
  if (confDisplay) confDisplay.textContent = `${conf}%`;
  if (confBar)  confBar.style.width  = `${Math.min(conf, 100)}%`;
  if (confPct)  confPct.textContent  = `${conf}%`;

  const name = data.name;
  const now  = Date.now();

  // Update roll if in session
  if (sessionActive && data.marked !== undefined) {
    if (data.status === "wrong_class") {
      showToast(data.message || `⚠️ ${name} does not belong to this class section.`, "warning");
    } else if (data.status === "verifying_liveness") {
      // Don't show toast to prevent spamming
    } else if (data.status === "spoof_detected") {
      showToast(data.message || `❌ Spoof attempt blocked for ${name}!`, "error");
    } else {
      refreshRollFromSession();
      if (data.marked && !data.alreadyMarked) {
        showToast(`✅ ${name} marked ${data.status || "present"}`, "success");
      }
    }
  }

  // Show recognition card (with cooldown to prevent flicker)
  if (name !== _lastShownName || now - _lastShownTs > COOLDOWN) {
    _lastShownName = name;
    _lastShownTs   = now;
    showRecognized(data);
  }
}

function showIdle() {
  stateIdle?.classList.remove("hidden");
  stateRec?.classList.add("hidden");
  stateUnknown?.classList.add("hidden");
  recCard?.classList.remove("state-present", "state-already", "state-unknown");
}

function showUnknown() {
  stateIdle?.classList.add("hidden");
  stateRec?.classList.add("hidden");
  stateUnknown?.classList.remove("hidden");
  recCard?.classList.remove("state-present", "state-already");
  recCard?.classList.add("state-unknown");
}

function showRecognized(data) {
  stateIdle?.classList.add("hidden");
  stateUnknown?.classList.add("hidden");
  stateRec?.classList.remove("hidden");

  const name    = data.name;
  const status  = data.status || "present";
  const already = data.alreadyMarked;

  if (recAvatar)    recAvatar.src    = `/api/students/${encodeURIComponent(name)}/photo`;
  if (recName)      recName.textContent = name;
  if (recStudentId) recStudentId.textContent = data.profile?.studentId ? `ID: ${data.profile.studentId}` : "";

  // Status badge
  if (recStatusBadge) {
    recStatusBadge.className = "badge";
    if (status === "wrong_class") {
      recStatusBadge.textContent = "Wrong Section";
      recStatusBadge.classList.add("badge-warning");
      recCard?.classList.remove("state-present", "state-already");
      recCard?.classList.add("state-unknown");
      if (recName) recName.textContent = data.message || "Does not belong here";
    } else if (status === "verifying_liveness") {
      recStatusBadge.textContent = "Verifying Liveness";
      recStatusBadge.classList.add("badge-blue");
      recCard?.classList.remove("state-present", "state-already");
      recCard?.classList.add("state-unknown");
      if (recName) recName.textContent = `${name} (Verifying...)`;
      if (recMarkedAt) recMarkedAt.textContent = data.message || "";
    } else if (status === "spoof_detected") {
      recStatusBadge.textContent = "Spoof Blocked";
      recStatusBadge.classList.add("badge-red");
      recCard?.classList.remove("state-present", "state-already");
      recCard?.classList.add("state-unknown");
      if (recName) recName.textContent = `${name} (Static Photo)`;
      if (recMarkedAt) recMarkedAt.textContent = data.message || "";
    } else if (already) {
      recStatusBadge.textContent = "Already Marked";
      recStatusBadge.classList.add("badge-info");
      recCard?.classList.remove("state-present", "state-unknown");
      recCard?.classList.add("state-already");
    } else if (status === "late") {
      recStatusBadge.textContent = "Late";
      recStatusBadge.classList.add("badge-warning");
      recCard?.classList.remove("state-already", "state-unknown");
      recCard?.classList.add("state-present");
    } else {
      recStatusBadge.textContent = sessionActive ? "Present ✓" : "Recognized";
      recStatusBadge.classList.add("badge-success");
      recCard?.classList.remove("state-already", "state-unknown");
      recCard?.classList.add("state-present");
    }
  }

  if (recMarkedAt && data.markedAt) recMarkedAt.textContent = `Marked at ${data.markedAt}`;
  else if (recMarkedAt && status !== "verifying_liveness" && status !== "spoof_detected") recMarkedAt.textContent = "";
}

// ─── Roll Table ───────────────────────────────────────────────
let _rollRecords = [];

function renderRoll(records) {
  _rollRecords = records;
  updateRollDisplay();
  updateCounters(records);
}

function updateRollDisplay() {
  const q = (rollSearch?.value || "").toLowerCase();
  const records = _rollRecords.filter(r =>
    !q || r.name.toLowerCase().includes(q) || (r.rollNo || "").toLowerCase().includes(q)
  );
  if (!rollBody) return;

  if (records.length === 0) {
    rollBody.innerHTML = `<tr><td colspan="5" class="text-center text-muted" style="padding:1.5rem;">No records</td></tr>`;
    return;
  }

  rollBody.innerHTML = records.map(r => {
    const statusCls = r.status === "present" ? "is-present" : r.status === "late" ? "is-late" : "";
    const badgeCls  = r.status === "present" ? "status-present" : r.status === "late" ? "status-late" : "status-absent";
    return `
    <tr class="${statusCls}" data-name="${r.name}">
      <td><span class="font-semibold">${r.name}</span></td>
      <td class="text-muted">${r.rollNo || "—"}</td>
      <td><span class="badge ${badgeCls}">${r.status || "absent"}</span></td>
      <td class="text-muted text-xs">${r.markedAt || "—"}</td>
      <td>
        ${r.status !== "present" ?
          `<button class="btn btn-ghost btn-sm" style="padding:0.2rem 0.5rem; font-size:0.72rem;" onclick="manualMark('${r.name}','present')">✓</button>` : ""}
        ${r.status !== "absent" ?
          `<button class="btn btn-ghost btn-sm" style="padding:0.2rem 0.5rem; font-size:0.72rem;" onclick="manualMark('${r.name}','absent')">✗</button>` : ""}
      </td>
    </tr>`;
  }).join("");
}

function updateCounters(records) {
  const p = records.filter(r => r.status === "present").length;
  const l = records.filter(r => r.status === "late").length;
  const a = records.filter(r => r.status === "absent").length;
  if (cntPresent) cntPresent.textContent = p;
  if (cntAbsent)  cntAbsent.textContent  = a;
  if (cntLate)    cntLate.textContent    = l;
}

function resetCounters() {
  if (cntPresent) cntPresent.textContent = "0";
  if (cntAbsent)  cntAbsent.textContent  = "0";
  if (cntLate)    cntLate.textContent    = "0";
}

async function refreshRollFromSession() {
  try {
    const r = await fetch(`/api/attendance/session?class_id=${currentClassId || ""}`);
    const d = await r.json();
    if (d.session && d.session.records) {
      renderRoll(d.session.records);
    }
  } catch (e) {}
}

// Manual mark override
window.manualMark = async function (name, status) {
  try {
    const res  = await fetch("/api/attendance/manual", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, status, classId: currentClassId }),
    });
    const data = await res.json();
    if (!data.success) { showToast(data.error, "error"); return; }
    await refreshRollFromSession();
    showToast(`${name} marked ${status}`, status === "present" ? "success" : "info");
  } catch (e) {
    showToast("Manual mark failed.", "error");
  }
};

// Roll search
if (rollSearch) rollSearch.addEventListener("input", updateRollDisplay);

// ─── Check for existing active session on load ────────────────
async function checkExistingSession() {
  try {
    const res  = await fetch(`/api/attendance/session?class_id=${currentClassId || ""}`);
    const data = await res.json();
    if (data.active) {
      let sess = null;
      if (data.session) {
        sess = data.session;
      } else if (data.sessions && data.sessions.length >= 1) {
        const mySess = data.sessions.find(s => s.teacher && typeof CURRENT_USER_NAME !== 'undefined' && s.teacher.trim().toLowerCase() === CURRENT_USER_NAME.trim().toLowerCase());
        if (mySess) {
          sess = mySess;
          currentClassId = sess.classId;
          window.history.replaceState({}, "", `/attend?class_id=${currentClassId}`);
        }
      }
      
      if (sess) {
        sessionActive = true;
        sessionData   = sess;
        updateSessionBanner();
        renderRoll(sess.records || []);
        showToast(`Resuming session: ${sess.subject}`, "info");
      }
    }
  } catch (e) {}
}

// ─── Init ─────────────────────────────────────────────────────
checkExistingSession();
