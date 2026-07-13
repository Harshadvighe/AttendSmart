/* ============================================================
   register.js — Student Enrollment with Webcam Capture
   ============================================================ */

let stream      = null;
let capturedB64 = null;
let capturing   = false;

// DOM refs
const video          = document.getElementById("webcamVideo");
const canvas         = document.getElementById("webcamCanvas");
const ctx            = canvas?.getContext("2d");
const webcamWrapper  = document.getElementById("webcamWrapper");
const capturedWrap   = document.getElementById("capturedWrap");
const capturedPrev   = document.getElementById("capturedPreview");
const countdownRing  = document.getElementById("countdownOverlay");
const startCamBtn    = document.getElementById("startCamBtn");
const captureBtn     = document.getElementById("captureBtn");
const retakeBtn      = document.getElementById("retakeBtn");
const enrollBtn      = document.getElementById("enrollBtn");
const camStatus      = document.getElementById("camStatusText");
const successCard    = document.getElementById("successCard");
const enrollAnother  = document.getElementById("enrollAnother");

// Step indicators
const step1 = document.getElementById("step1");
const step2 = document.getElementById("step2");
const step3 = document.getElementById("step3");

// ─── Utilities ────────────────────────────────────────────────
function showToast(msg, type = "info") {
  const c = document.getElementById("toastContainer");
  if (!c) return;
  const icons = { success: "✅", error: "❌", warning: "⚠️", info: "ℹ️" };
  const t = document.createElement("div");
  t.className = `toast toast-${type}`;
  t.innerHTML = `<span>${icons[type]}</span><span>${msg}</span>`;
  c.appendChild(t);
  setTimeout(() => { t.classList.add("removing"); setTimeout(() => t.remove(), 260); }, 5000);
}

function setStep(n) {
  [step1, step2, step3].forEach((s, i) => {
    if (!s) return;
    s.className = "step" + (i < n ? " complete" : i === n ? " active" : "");
  });
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

// ─── Stats ────────────────────────────────────────────────────
async function loadStats() {
  try {
    const r = await fetch("/api/stats");
    const d = await r.json();
    const b = document.getElementById("enrolledCount");
    if (b && d.success) b.textContent = `${d.enrolled_students} Students`;
  } catch (e) {}
}
loadStats();

// ─── Camera ───────────────────────────────────────────────────
startCamBtn?.addEventListener("click", startCamera);

async function startCamera() {
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: "user", width: 640, height: 480 },
      audio: false,
    });
    video.srcObject = stream;
    startCamBtn.classList.add("hidden");
    captureBtn?.classList.remove("hidden");
    if (camStatus) camStatus.textContent = "Position your face in the frame";
    setStep(1);
  } catch (e) {
    showToast("Camera error: " + e.message, "error");
  }
}

function stopCamera() {
  if (stream) { stream.getTracks().forEach(t => t.stop()); stream = null; }
  video.srcObject = null;
}

// ─── Countdown Capture ────────────────────────────────────────
captureBtn?.addEventListener("click", startCountdown);

function startCountdown() {
  if (capturing) return;
  capturing = true;
  captureBtn.disabled = true;
  countdownRing.style.display = "flex";

  let count = 3;
  countdownRing.textContent = count;

  const t = setInterval(() => {
    count--;
    if (count > 0) {
      countdownRing.textContent = count;
    } else {
      clearInterval(t);
      countdownRing.style.display = "none";
      doCapture();
      capturing = false;
    }
  }, 1000);
}

function doCapture() {
  if (!canvas || !video) return;
  canvas.width  = video.videoWidth  || 640;
  canvas.height = video.videoHeight || 480;
  ctx.drawImage(video, 0, 0);
  capturedB64 = canvas.toDataURL("image/jpeg", 0.9);

  // Show preview
  if (capturedPrev) { capturedPrev.src = capturedB64; }
  if (capturedWrap) { capturedWrap.style.display = "block"; }

  // Swap webcam for preview
  if (video)        { video.style.display = "none"; }

  // Show retake, hide capture
  captureBtn?.classList.add("hidden");
  retakeBtn?.classList.remove("hidden");
  stopCamera();

  setStep(2);
  checkEnrollReady();
  if (camStatus) camStatus.textContent = "Photo captured! Fill in details below.";
  showToast("Photo captured successfully.", "success");
}

retakeBtn?.addEventListener("click", async () => {
  capturedB64 = null;
  if (capturedWrap) capturedWrap.style.display = "none";
  if (video)        video.style.display = "";
  retakeBtn.classList.add("hidden");
  captureBtn.classList.remove("hidden");
  captureBtn.disabled = false;
  enrollBtn && (enrollBtn.disabled = true);
  setStep(1);
  if (camStatus) camStatus.textContent = "Retaking — position your face";
  await startCamera();
});

// ─── Form Validation ──────────────────────────────────────────
const requiredFields = [
  document.getElementById("fName"),
  document.getElementById("fStudentId"),
  document.getElementById("fPassword"),
];
requiredFields.forEach(f => f?.addEventListener("input", checkEnrollReady));

function checkEnrollReady() {
  const hasPhoto = !!capturedB64;
  const hasName  = !!(document.getElementById("fName")?.value.trim());
  const hasId    = !!(document.getElementById("fStudentId")?.value.trim());
  const hasPass  = !!(document.getElementById("fPassword")?.value.trim());
  if (enrollBtn) enrollBtn.disabled = !(hasPhoto && hasName && hasId && hasPass);
}

// ─── Enroll ───────────────────────────────────────────────────
enrollBtn?.addEventListener("click", async () => {
  const name      = document.getElementById("fName")?.value.trim();
  const studentId = document.getElementById("fStudentId")?.value.trim();
  const password  = document.getElementById("fPassword")?.value.trim();
  const section   = document.getElementById("fSection")?.value.trim();
  const rollNo    = document.getElementById("fRollNo")?.value.trim();
  const dept      = document.getElementById("fDept")?.value.trim();
  const year      = document.getElementById("fYear")?.value.trim();
  const email     = document.getElementById("fEmail")?.value.trim();
  const phone     = document.getElementById("fPhone")?.value.trim();

  if (!capturedB64) { showToast("Please capture a photo first.", "warning"); return; }
  if (!name)        { showToast("Name is required.", "warning"); return; }
  if (!studentId)   { showToast("Student ID is required.", "warning"); return; }
  if (!password)    { showToast("Password is required.", "warning"); return; }

  enrollBtn.disabled = true;
  enrollBtn.textContent = "⏳ Enrolling…";

  try {
    const res  = await fetch("/api/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ image: capturedB64, name, studentId, password, section, rollNo, department: dept, year, email, phone }),
    });
    const data = await res.json();

    if (!data.success) {
      showToast(data.error || "Enrollment failed.", "error");
      enrollBtn.disabled  = false;
      enrollBtn.textContent = "➕ Enroll Student";
      return;
    }

    // Success
    setStep(3);
    enrollBtn.classList.add("hidden");
    if (successCard) {
      successCard.classList.remove("hidden");
      const sn = document.getElementById("successName");
      if (sn) sn.textContent = `${data.name} Enrolled! 🎉`;
    }
    loadStats();

  } catch (e) {
    showToast("Server error: " + e.message, "error");
    enrollBtn.disabled  = false;
    enrollBtn.textContent = "➕ Enroll Student";
  }
});

// ─── Enroll Another ───────────────────────────────────────────
enrollAnother?.addEventListener("click", () => {
  capturedB64 = null;
  if (capturedWrap)  capturedWrap.style.display  = "none";
  if (video)         video.style.display         = "";
  retakeBtn?.classList.add("hidden");
  captureBtn?.classList.remove("hidden");
  startCamBtn?.classList.remove("hidden");
  captureBtn?.classList.add("hidden");
  enrollBtn?.classList.remove("hidden");
  enrollBtn && (enrollBtn.disabled = true);
  enrollBtn && (enrollBtn.textContent = "➕ Enroll Student");
  successCard?.classList.add("hidden");
  // Clear form
  ["fName","fStudentId","fPassword","fSection","fRollNo","fDept","fYear","fEmail","fPhone"]
    .forEach(id => { const el = document.getElementById(id); if (el) el.value = ""; });
  setStep(0);
});
