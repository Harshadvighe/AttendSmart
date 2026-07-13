/* ============================================================
   sidebar.js — Shared: theme, collapse, mobile, clock, toast
   ============================================================ */
(function () {
  'use strict';

  /* ── Theme ───────────────────────────────────────────────── */
  const root  = document.documentElement;
  const saved = localStorage.getItem('theme') || 'dark';
  root.setAttribute('data-theme', saved);

  const SUN  = '<path stroke-linecap="round" stroke-linejoin="round" d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364-6.364l-.707.707M6.343 17.657l-.707.707M17.657 17.657l-.707-.707M6.343 6.343l-.707-.707M12 8a4 4 0 100 8 4 4 0 000-8z"/>';
  const MOON = '<path stroke-linecap="round" stroke-linejoin="round" d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z"/>';

  function setThemeIcons(t) {
    document.querySelectorAll('.theme-icon').forEach(el => { el.innerHTML = t === 'dark' ? SUN : MOON; });
  }
  setThemeIcons(saved);

  document.addEventListener('click', e => {
    if (e.target.closest('.theme-btn')) {
      const next = root.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
      root.setAttribute('data-theme', next);
      localStorage.setItem('theme', next);
      setThemeIcons(next);
    }
  });

  /* ── Sidebar collapse ────────────────────────────────────── */
  const sidebar = document.getElementById('sidebar');
  if (sidebar) {
    if (localStorage.getItem('sbCollapsed') === '1') sidebar.classList.add('collapsed');
    const toggle = document.getElementById('sbToggle');
    if (toggle) toggle.addEventListener('click', () => {
      sidebar.classList.toggle('collapsed');
      localStorage.setItem('sbCollapsed', sidebar.classList.contains('collapsed') ? '1' : '0');
    });

    /* mobile */
    const overlay  = document.getElementById('sbOverlay');
    const mobileBtn = document.getElementById('sbMobileBtn');
    if (mobileBtn) mobileBtn.addEventListener('click', () => {
      sidebar.classList.toggle('open');
      overlay && overlay.classList.toggle('on');
    });
    if (overlay) overlay.addEventListener('click', () => {
      sidebar.classList.remove('open');
      overlay.classList.remove('on');
    });
  }

  /* ── Live clock ──────────────────────────────────────────── */
  function tick() {
    const now = new Date();
    const t   = now.toLocaleTimeString('en-IN', { hour12: false });
    const d   = now.toLocaleDateString('en-IN', { weekday: 'short', month: 'short', day: 'numeric' });
    document.querySelectorAll('.live-clock').forEach(el => (el.textContent = t));
    document.querySelectorAll('.live-date').forEach(el => (el.textContent = d));
  }
  tick(); setInterval(tick, 1000);

  /* ── User dropdown ───────────────────────────────────────── */
  const userBtn  = document.getElementById('userBtn');
  const userMenu = document.getElementById('userMenu');
  if (userBtn && userMenu) {
    userBtn.addEventListener('click', e => { e.stopPropagation(); userMenu.classList.toggle('hidden'); });
    document.addEventListener('click', () => userMenu && userMenu.classList.add('hidden'));
  }

  /* ── Toast (global) ──────────────────────────────────────── */
  window.showToast = function (msg, type = 'info') {
    const icons = { success: '✓', error: '✕', warning: '!', info: 'i' };
    const c = document.getElementById('toastContainer');
    if (!c) return;
    const t = document.createElement('div');
    t.className = `toast toast-${type}`;
    t.innerHTML = `<span class="toast-icon">${icons[type] || 'i'}</span><span>${msg}</span>`;
    c.appendChild(t);
    setTimeout(() => { t.classList.add('removing'); setTimeout(() => t.remove(), 260); }, 4200);
  };
})();
