/**
 * recognition.js — Live face recognition controller for index.html
 *
 * Flow:
 *  1. User clicks "Start Camera" → webcam stream starts.
 *  2. Every CAPTURE_INTERVAL ms, a frame is captured from the video element.
 *  3. Frame is sent as base64 JPEG to POST /api/recognize.
 *  4. Response updates the recognition card, stats, and triggers voice greeting.
 *  5. Same person is not greeted again for GREET_COOLDOWN_MS ms.
 */

'use strict';

// ── Constants ───────────────────────────────────────────────────────────────
const CAPTURE_INTERVAL  = 600;     // ms between recognition attempts (≈ 1-2 FPS)
const JPEG_QUALITY      = 0.7;     // canvas toDataURL quality
const GREET_COOLDOWN_MS = 10_000;  // 10s before greeting same person again
const RECOGNIZE_URL     = '/api/recognize';
const STATS_URL         = '/api/stats';

// Fun random messages
const FUN_MESSAGES = [
  'Welcome Back Champion! 🏆',
  'Looking Great Today! ✨',
  'Hope You Win Today! 🎯',
  'Have an Awesome Day! 🚀',
  'You Are On Fire! 🔥',
  'Stay Amazing! ⭐',
  'Great to See You! 😎',
  'Let\'s Crush It Today! 💪',
  'Shine On! 🌟',
  'Positive Vibes Only! 🌈',
];

const EMOJIS = ['👋', '🎉', '😎', '🚀', '🔥', '⭐', '🏆', '✨', '💫', '🎊', '🌟', '💥'];

// ── State ────────────────────────────────────────────────────────────────────
let stream          = null;
let recognizeTimer  = null;
let isRecognizing   = false;
let lastGreeted     = {};   // { name: timestamp }
let sessionRecognized = 0;
let sessionUnknown    = 0;
let fpsStartTime    = Date.now();
let fpsFrameCount   = 0;

// ── DOM Refs ─────────────────────────────────────────────────────────────────
const video          = document.getElementById('webcamVideo');
const canvas         = document.getElementById('webcamCanvas');
const startCamBtn    = document.getElementById('startCamBtn');
const stopCamBtn     = document.getElementById('stopCamBtn');
const statusText     = document.getElementById('statusText');
const camDot         = document.getElementById('camDot');
const faceDot        = document.getElementById('faceDot');
const recDot         = document.getElementById('recDot');
const fpsDisplay     = document.getElementById('fpsDisplay');
const confDisplay    = document.getElementById('confDisplay');
const liveClock      = document.getElementById('liveClock');
const liveDate       = document.getElementById('liveDate');
const recognitionCard = document.getElementById('recognitionCard');
const stateIdle      = document.getElementById('stateIdle');
const stateRecognized = document.getElementById('stateRecognized');
const stateUnknown   = document.getElementById('stateUnknown');
const faceBracket    = document.getElementById('faceBracket');
const registeredCount = document.getElementById('registeredCount');
const statUsers      = document.getElementById('statUsers');
const statRecognitions = document.getElementById('statRecognitions');
const statUnknowns   = document.getElementById('statUnknowns');
const themeToggle    = document.getElementById('themeToggle');

// ── Theme Toggle ─────────────────────────────────────────────────────────────
(function initTheme() {
  const saved = localStorage.getItem('theme') || 'dark';
  document.documentElement.setAttribute('data-theme', saved);
  themeToggle.textContent = saved === 'dark' ? '☀️' : '🌙';
})();

themeToggle.addEventListener('click', () => {
  const current = document.documentElement.getAttribute('data-theme');
  const next = current === 'dark' ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', next);
  localStorage.setItem('theme', next);
  themeToggle.textContent = next === 'dark' ? '☀️' : '🌙';
});

// ── Live Clock ────────────────────────────────────────────────────────────────
function updateClock() {
  const now = new Date();
  liveClock.textContent = now.toLocaleTimeString('en-IN', { hour12: false });
  liveDate.textContent  = now.toLocaleDateString('en-IN', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
  });
}
updateClock();
setInterval(updateClock, 1000);

// ── Greeting helpers ──────────────────────────────────────────────────────────
function getTimeGreeting() {
  const h = new Date().getHours();
  if (h >= 5  && h < 12) return 'Good Morning';
  if (h >= 12 && h < 17) return 'Good Afternoon';
  if (h >= 17 && h < 21) return 'Good Evening';
  return 'Good Night';
}

function getRandomFrom(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

// ── Voice Greeting ────────────────────────────────────────────────────────────
function speak(text) {
  if (!window.speechSynthesis) return;
  window.speechSynthesis.cancel();
  const utt = new SpeechSynthesisUtterance(text);
  utt.rate = 0.95;
  utt.pitch = 1.05;
  utt.volume = 1;
  window.speechSynthesis.speak(utt);
}

// ── Stats Loader ──────────────────────────────────────────────────────────────
async function loadStats() {
  try {
    const res = await fetch(STATS_URL);
    const data = await res.json();
    if (data.success) {
      const n = data.registered_count;
      if (registeredCount) registeredCount.textContent = `${n} User${n !== 1 ? 's' : ''}`;
      if (statUsers) statUsers.textContent = n;
    }
  } catch { /* silent */ }
}
loadStats();
setInterval(loadStats, 30_000);

// ── Camera Controls ───────────────────────────────────────────────────────────
startCamBtn.addEventListener('click', startCamera);
stopCamBtn.addEventListener('click',  stopCamera);

async function startCamera() {
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      video: { width: { ideal: 640 }, height: { ideal: 480 }, facingMode: 'user' },
      audio: false,
    });
    video.srcObject = stream;
    await video.play();

    startCamBtn.classList.add('hidden');
    stopCamBtn.classList.remove('hidden');
    camDot.classList.add('active');
    statusText.textContent = 'Camera active — recognizing…';
    statusText.style.color = 'var(--clr-success)';

    // Sync canvas size after video metadata loads
    video.addEventListener('loadedmetadata', () => {
      canvas.width  = video.videoWidth;
      canvas.height = video.videoHeight;
    }, { once: true });

    startRecognitionLoop();
    showToast('📷 Camera started', 'success');
  } catch (err) {
    showToast(`Camera error: ${err.message}`, 'error');
    statusText.textContent = 'Camera access denied.';
  }
}

function stopCamera() {
  if (stream) {
    stream.getTracks().forEach(t => t.stop());
    stream = null;
  }
  video.srcObject = null;
  stopRecognitionLoop();

  startCamBtn.classList.remove('hidden');
  stopCamBtn.classList.add('hidden');
  camDot.classList.remove('active', 'pulse');
  faceDot.classList.remove('active', 'pulse');
  recDot.classList.remove('active');
  statusText.textContent = 'Camera stopped';
  statusText.style.color = 'var(--txt-muted)';

  setRecognitionState('idle');
}

// ── Recognition Loop ──────────────────────────────────────────────────────────
function startRecognitionLoop() {
  if (recognizeTimer) clearInterval(recognizeTimer);
  fpsStartTime  = Date.now();
  fpsFrameCount = 0;
  recognizeTimer = setInterval(captureAndRecognize, CAPTURE_INTERVAL);
}

function stopRecognitionLoop() {
  if (recognizeTimer) clearInterval(recognizeTimer);
  recognizeTimer = null;
  isRecognizing  = false;
}

async function captureAndRecognize() {
  if (isRecognizing || !stream) return;
  if (video.readyState < 2) return;

  isRecognizing = true;

  // Update FPS counter
  fpsFrameCount++;
  const elapsed = (Date.now() - fpsStartTime) / 1000;
  if (elapsed > 0) {
    fpsDisplay.textContent = (fpsFrameCount / elapsed).toFixed(1);
  }

  try {
    // Draw video frame to canvas and extract base64 JPEG
    const ctx = canvas.getContext('2d');
    canvas.width  = video.videoWidth  || 640;
    canvas.height = video.videoHeight || 480;
    ctx.save();
    ctx.scale(-1, 1);
    ctx.drawImage(video, -canvas.width, 0, canvas.width, canvas.height);
    ctx.restore();

    const b64 = canvas.toDataURL('image/jpeg', JPEG_QUALITY);

    // Send to backend
    const res  = await fetch(RECOGNIZE_URL, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ image: b64 }),
    });
    const data = await res.json();

    handleRecognitionResult(data);
  } catch (err) {
    console.warn('Recognition error:', err);
  } finally {
    isRecognizing = false;
  }
}

// ── Handle API Result ─────────────────────────────────────────────────────────
function handleRecognitionResult(data) {
  if (!data.success) return;

  confDisplay.textContent = data.confidence ? `${data.confidence}%` : '—';

  if (!data.face_detected) {
    // No face in frame
    faceDot.classList.remove('active', 'pulse');
    recDot.classList.remove('active');
    faceBracket.className = 'face-bracket';
    setRecognitionState('idle');
    return;
  }

  // Face detected
  faceDot.classList.add('pulse');

  if (data.recognized && data.profile) {
    const name = data.name;
    recDot.classList.add('active');
    faceBracket.className = 'face-bracket detected';

    showRecognized(name, data.confidence, data.profile);

    // Greet with cooldown
    const now = Date.now();
    if (!lastGreeted[name] || now - lastGreeted[name] > GREET_COOLDOWN_MS) {
      lastGreeted[name] = now;
      sessionRecognized++;
      statRecognitions.textContent = sessionRecognized;
      triggerGreeting(name, data.profile);
    }
  } else {
    // Face detected but not recognized
    recDot.classList.remove('active');
    faceBracket.className = 'face-bracket unknown';
    setRecognitionState('unknown');
    sessionUnknown++;
    statUnknowns.textContent = sessionUnknown;
  }
}

// ── Display Recognized Card ───────────────────────────────────────────────────
function showRecognized(name, confidence, profile) {
  setRecognitionState('recognized');

  document.getElementById('recName').textContent    = name;
  document.getElementById('recGreeting').textContent = `${getTimeGreeting()} 👋`;
  document.getElementById('recEmoji').textContent   = getRandomFrom(EMOJIS);
  document.getElementById('welcomeMsg').textContent = profile.welcomeMessage || `Welcome Back ${name}!`;

  // Avatar
  const avatar = document.getElementById('recAvatar');
  avatar.src   = `/api/users/${encodeURIComponent(name)}/photo?t=${Date.now()}`;
  avatar.onerror = () => { avatar.src = ''; avatar.style.display = 'none'; };

  // Confidence bar
  const pct = Math.min(100, Math.max(0, confidence));
  document.getElementById('confidenceBar').style.width = pct + '%';
  document.getElementById('confidencePct').textContent = pct + '%';

  // Profile details grid
  const details = document.getElementById('recDetails');
  const fields = [
    { label: '🏢 Profession',     value: profile.profession },
    { label: '📍 City',           value: profile.city },
    { label: '🎨 Favorite Color', value: profile.favoriteColor },
    { label: '🎮 Hobby',          value: profile.hobby },
    { label: '🎂 Age',            value: profile.age },
    { label: '⚧ Gender',         value: profile.gender },
  ];
  details.innerHTML = fields
    .filter(f => f.value)
    .map(f => `
      <div class="rec-detail-item">
        <div class="rec-detail-label">${f.label}</div>
        <div class="rec-detail-value">${f.value}</div>
      </div>`)
    .join('');
}

// ── Voice + Fun Greeting ──────────────────────────────────────────────────────
function triggerGreeting(name, profile) {
  const greeting    = getTimeGreeting();
  const funMsg      = getRandomFrom(FUN_MESSAGES);
  const welcomeMsg  = profile.welcomeMessage || `Welcome Back ${name}`;
  const speechText  = `Hello ${name}. ${welcomeMsg}. ${greeting}. ${funMsg}`;

  speak(speechText);
  showToast(`👋 Hello ${name} — ${greeting}!`, 'success');
}

// ── State Machine ─────────────────────────────────────────────────────────────
function setRecognitionState(state) {
  stateIdle.classList.add('hidden');
  stateRecognized.classList.add('hidden');
  stateUnknown.classList.add('hidden');
  recognitionCard.className = 'recognition-card';

  if (state === 'recognized') {
    stateRecognized.classList.remove('hidden');
    recognitionCard.classList.add('state-recognized');
  } else if (state === 'unknown') {
    stateUnknown.classList.remove('hidden');
    recognitionCard.classList.add('state-unknown');
  } else {
    stateIdle.classList.remove('hidden');
    recognitionCard.classList.add('state-idle');
  }
}

// ── Toast Notifications ───────────────────────────────────────────────────────
function showToast(message, type = 'info', duration = 4000) {
  const container = document.getElementById('toastContainer');
  const toast     = document.createElement('div');
  const icons     = { success: '✅', error: '❌', info: 'ℹ️' };
  toast.className = `toast toast-${type}`;
  toast.innerHTML = `<span class="toast-icon">${icons[type] || 'ℹ️'}</span>
                     <span class="toast-msg">${message}</span>`;
  container.appendChild(toast);
  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateX(40px)';
    toast.style.transition = 'all 0.3s ease';
    setTimeout(() => toast.remove(), 300);
  }, duration);
}

// ── Auto-start camera on page load ────────────────────────────────────────────
// Uncomment the line below if you want the camera to start automatically:
// window.addEventListener('load', () => setTimeout(startCamera, 500));
