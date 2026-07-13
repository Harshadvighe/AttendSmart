/* ============================================================
   dashboard.js — Attendance Dashboard (v2 — new CSS)
   ============================================================ */

/* ── Stats ────────────────────────────────────────────────── */
async function loadStats() {
  try {
    const r = await fetch('/api/stats'), d = await r.json();
    if (!d.success) return;
    const el = document.getElementById('statEnrolled');
    if (el) el.textContent = d.enrolled_students;
  } catch (e) { /* silent */ }
}

/* ── Today Summary ───────────────────────────────────────── */
function attClass(pct) {
  return pct >= 75 ? 'abf-high' : pct >= 50 ? 'abf-mid' : 'abf-low';
}

function buildClassCard(cls) {
  const pct = cls.pct || 0;
  const live = cls.active;
  const endLbl = live
    ? `<span class="badge badge-green" style="font-size:.65rem"><span class="dot-live" style="width:5px;height:5px;border-radius:50%;display:inline-block;margin-right:3px"></span>LIVE</span>`
    : (cls.endTime ? `<span class="badge badge-neutral" style="font-size:.65rem">Ended ${cls.endTime}</span>` : '');

  return `
  <div class="class-card ${live ? 'live' : ''}">
    <div class="flex items-center justify-between gap-2">
      <div>
        <div class="fw-6" style="font-size:.9375rem">${cls.subject || '—'}</div>
        <div class="text-xs text-muted">${cls.section || ''} ${cls.teacher ? '· ' + cls.teacher : ''}</div>
      </div>
      ${endLbl}
    </div>
    <div class="flex items-center gap-3 text-sm">
      <span class="text-green fw-6">${cls.present} Present</span>
      <span class="text-muted">·</span>
      <span class="text-red">${cls.absent} Absent</span>
      <span style="margin-left:auto;font-size:1rem;font-weight:700">${pct}%</span>
    </div>
    <div class="att-bar"><div class="att-bar-fill ${attClass(pct)}" style="width:${pct}%"></div></div>
    <div class="flex gap-2">
      <a href="/reports?class_id=${encodeURIComponent(cls.classId||'')}" class="btn btn-ghost btn-sm flex-1">Report</a>
      ${live ? `<a href="/attend?class_id=${encodeURIComponent(cls.classId||'')}" class="btn btn-success btn-sm flex-1">Join</a>` : ''}
    </div>
  </div>`;
}

async function loadTodaySummary() {
  try {
    const r = await fetch('/api/attendance/today'), d = await r.json();
    if (!d.success) return;

    const sub = document.getElementById('heroSub');
    if (sub) sub.textContent = `${d.sessions} session${d.sessions !== 1 ? 's' : ''} today · ${d.totalPresent} students marked present`;

    const sp = document.getElementById('statPresent');
    const ss = document.getElementById('statSessions');
    const sa = document.getElementById('statActive');
    if (sp) sp.textContent = d.totalPresent;
    if (ss) ss.textContent = d.sessions;
    if (sa) sa.textContent = d.activeSession ? 'Yes 🟢' : 'None';

    const grid = document.getElementById('classesGrid');
    if (!grid) return;

    if (!d.classSummaries || !d.classSummaries.length) {
      grid.innerHTML = `
        <div class="card" style="grid-column:1/-1">
          <div class="empty-state">
            <div class="empty-icon"><svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"/></svg></div>
            <div class="empty-title">No sessions today</div>
            <div class="empty-sub">Take attendance to see class summaries here</div>
            <a href="/attend" class="btn btn-primary btn-sm" style="margin-top:12px">Take Attendance</a>
          </div>
        </div>`;
      return;
    }

    grid.innerHTML = d.classSummaries.map(buildClassCard).join('');
    buildActivityList(d.classSummaries);
  } catch (e) { /* silent */ }
}

function buildActivityList(classes) {
  const list = document.getElementById('activityList');
  if (!list) return;
  if (!classes.length) return;
  list.innerHTML = classes.map(c => `
    <div class="activity-item">
      <div class="a-icon">${c.active ? '🟢' : '✅'}</div>
      <div>
        <div class="a-title">${c.subject}</div>
        <div class="a-sub">${c.section || ''} · ${c.present}/${c.total} present</div>
      </div>
      <span class="a-time">${c.startTime || '—'}</span>
    </div>`).join('');
}

/* ── Init ─────────────────────────────────────────────────── */
(async function init() {
  await loadStats();
  await loadTodaySummary();
  setInterval(async () => { await loadStats(); await loadTodaySummary(); }, 30_000);
})();
