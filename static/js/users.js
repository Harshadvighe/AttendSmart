/**
 * users.js — User management dashboard controller for users.html
 *
 * Features:
 *  - Load and display all registered users as cards
 *  - Real-time search by name, city, profession, hobby
 *  - Gender filter chips
 *  - View profile modal with full details
 *  - Edit profile modal
 *  - Delete with confirmation modal
 *  - Stats row (total, male, female, city count)
 */

'use strict';

const USERS_URL = '/api/users';

// ── State ─────────────────────────────────────────────────────────────────────
let allUsers     = [];
let filteredUsers = [];
let activeFilter = 'all';
let pendingDeleteName = null;

// ── DOM Refs ──────────────────────────────────────────────────────────────────
const usersGrid   = document.getElementById('usersGrid');
const searchInput = document.getElementById('searchInput');
const resultCount = document.getElementById('resultCount');
const themeToggle = document.getElementById('themeToggle');
const chips       = document.querySelectorAll('.chip[data-filter]');

// Stats
const totalCount  = document.getElementById('totalCount');
const maleCount   = document.getElementById('maleCount');
const femaleCount = document.getElementById('femaleCount');
const cityCount   = document.getElementById('cityCount');

// ── Theme Toggle ──────────────────────────────────────────────────────────────
(function initTheme() {
  const saved = localStorage.getItem('theme') || 'dark';
  document.documentElement.setAttribute('data-theme', saved);
  themeToggle.textContent = saved === 'dark' ? '☀️' : '🌙';
})();
themeToggle.addEventListener('click', () => {
  const cur  = document.documentElement.getAttribute('data-theme');
  const next = cur === 'dark' ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', next);
  localStorage.setItem('theme', next);
  themeToggle.textContent = next === 'dark' ? '☀️' : '🌙';
});

// ── Bootstrap ─────────────────────────────────────────────────────────────────
window.addEventListener('DOMContentLoaded', loadUsers);

async function loadUsers() {
  renderSkeletons(6);
  try {
    const res  = await fetch(USERS_URL);
    const data = await res.json();
    allUsers   = data.users || [];
    updateStats(allUsers);
    applyFilter();
  } catch (err) {
    usersGrid.innerHTML = `
      <div class="empty-state" style="grid-column:1/-1;">
        <div class="empty-state-icon">⚠️</div>
        <p>Failed to load users. Is the server running?</p>
      </div>`;
    showToast('Failed to connect to server.', 'error');
  }
}

// ── Stats Row ─────────────────────────────────────────────────────────────────
function updateStats(users) {
  totalCount.textContent  = users.length;
  maleCount.textContent   = users.filter(u => u.gender === 'Male').length;
  femaleCount.textContent = users.filter(u => u.gender === 'Female').length;
  cityCount.textContent   = new Set(users.map(u => u.city).filter(Boolean)).size;
}

// ── Search & Filter ───────────────────────────────────────────────────────────
searchInput.addEventListener('input', applyFilter);

chips.forEach(chip => {
  chip.addEventListener('click', () => {
    chips.forEach(c => c.classList.remove('active'));
    chip.classList.add('active');
    activeFilter = chip.dataset.filter;
    applyFilter();
  });
});

function applyFilter() {
  const query = searchInput.value.trim().toLowerCase();
  filteredUsers = allUsers.filter(u => {
    // Gender filter
    if (activeFilter !== 'all' && u.gender !== activeFilter) return false;
    // Text search
    if (!query) return true;
    return (
      (u.name        || '').toLowerCase().includes(query) ||
      (u.city        || '').toLowerCase().includes(query) ||
      (u.profession  || '').toLowerCase().includes(query) ||
      (u.hobby       || '').toLowerCase().includes(query)
    );
  });
  renderUsers(filteredUsers);
  resultCount.textContent = `${filteredUsers.length} of ${allUsers.length} user${allUsers.length !== 1 ? 's' : ''}`;
}

// ── Render ────────────────────────────────────────────────────────────────────
function renderUsers(users) {
  if (users.length === 0) {
    usersGrid.innerHTML = `
      <div class="empty-state" style="grid-column:1/-1;">
        <div class="empty-state-icon">👤</div>
        <p>No users found. <a href="/register" style="color:var(--clr-primary-lt);">Register someone</a>.</p>
      </div>`;
    return;
  }

  usersGrid.innerHTML = users.map((u, i) => `
    <div class="user-card" style="--i:${i};" data-name="${escapeHtml(u.name)}">
      <div class="user-card-photo-wrap">
        <img class="user-card-photo"
             src="/api/users/${encodeURIComponent(u.name)}/photo?t=${Date.now()}"
             alt="${escapeHtml(u.name)}"
             onerror="this.style.display='none'" />
        <div class="user-card-photo-overlay"></div>
      </div>
      <div class="user-card-body">
        <div class="user-card-name">${escapeHtml(u.name)}</div>
        <div class="user-card-meta mb-md">
          ${u.profession ? `<span class="profile-tag">🏢 ${escapeHtml(u.profession)}</span> ` : ''}
          ${u.city       ? `<span class="profile-tag">📍 ${escapeHtml(u.city)}</span>`       : ''}
        </div>
        <div class="flex gap-sm flex-wrap">
          ${u.age    ? `<span class="profile-tag">🎂 ${escapeHtml(u.age)}</span>` : ''}
          ${u.gender ? `<span class="profile-tag">⚧ ${escapeHtml(u.gender)}</span>` : ''}
          ${u.hobby  ? `<span class="profile-tag">🎮 ${escapeHtml(u.hobby)}</span>` : ''}
        </div>
      </div>
      <div class="user-card-actions">
        <button class="btn btn-ghost btn-sm" onclick="openViewModal('${escapeHtml(u.name)}')">👁️ View</button>
        <button class="btn btn-primary btn-sm" onclick="openEditModal('${escapeHtml(u.name)}')">✏️ Edit</button>
        <button class="btn btn-danger btn-sm" onclick="openDeleteModal('${escapeHtml(u.name)}')">🗑️</button>
      </div>
    </div>
  `).join('');
}

function renderSkeletons(n) {
  usersGrid.innerHTML = Array.from({ length: n }, () => `
    <div class="user-card" style="pointer-events:none;">
      <div class="skeleton" style="height:200px;border-radius:0;"></div>
      <div class="user-card-body">
        <div class="skeleton" style="height:22px;width:60%;border-radius:6px;margin-bottom:10px;"></div>
        <div class="skeleton" style="height:16px;width:80%;border-radius:6px;"></div>
      </div>
    </div>`).join('');
}

// ── View Modal ────────────────────────────────────────────────────────────────
const viewModal       = document.getElementById('viewModal');
const viewPhoto       = document.getElementById('viewPhoto');
const viewName        = document.getElementById('viewName');
const viewProfession  = document.getElementById('viewProfession');
const viewDetails     = document.getElementById('viewDetails');
const viewModalClose  = document.getElementById('viewModalClose');
const viewToEdit      = document.getElementById('viewToEdit');

let currentViewName = null;

function openViewModal(name) {
  const user = allUsers.find(u => u.name === name);
  if (!user) return;
  currentViewName = name;

  viewPhoto.src       = `/api/users/${encodeURIComponent(name)}/photo?t=${Date.now()}`;
  viewPhoto.onerror   = () => { viewPhoto.style.display = 'none'; };
  viewName.textContent       = user.name;
  viewProfession.textContent = user.profession || '';

  const fields = [
    { label: '🎂 Age',            value: user.age },
    { label: '⚧ Gender',         value: user.gender },
    { label: '📍 City',           value: user.city },
    { label: '🏢 Profession',     value: user.profession },
    { label: '🎮 Hobby',          value: user.hobby },
    { label: '🎨 Favorite Color', value: user.favoriteColor },
    { label: '💬 Welcome Msg',    value: user.welcomeMessage },
    { label: '📅 Registered',     value: user.registeredAt },
  ];

  viewDetails.innerHTML = fields.map(f => `
    <div class="modal-detail-item">
      <div class="modal-detail-label">${f.label}</div>
      <div class="modal-detail-value">${escapeHtml(f.value || '—')}</div>
    </div>`).join('');

  viewModal.classList.remove('hidden');
}

viewModalClose.addEventListener('click', () => viewModal.classList.add('hidden'));
viewToEdit.addEventListener('click', () => {
  viewModal.classList.add('hidden');
  openEditModal(currentViewName);
});
viewModal.addEventListener('click', (e) => {
  if (e.target === viewModal) viewModal.classList.add('hidden');
});

// ── Edit Modal ────────────────────────────────────────────────────────────────
const editModal     = document.getElementById('editModal');
const editForm      = document.getElementById('editForm');
const editModalClose = document.getElementById('editModalClose');
const editCancelBtn = document.getElementById('editCancelBtn');

function openEditModal(name) {
  const user = allUsers.find(u => u.name === name);
  if (!user) return;

  document.getElementById('editName').value           = user.name;
  document.getElementById('editAge').value            = user.age || '';
  document.getElementById('editGender').value         = user.gender || '';
  document.getElementById('editCity').value           = user.city || '';
  document.getElementById('editProfession').value     = user.profession || '';
  document.getElementById('editHobby').value          = user.hobby || '';
  document.getElementById('editFavoriteColor').value  = user.favoriteColor || '';
  document.getElementById('editWelcomeMessage').value = user.welcomeMessage || '';

  editModal.classList.remove('hidden');
}

editModalClose.addEventListener('click', () => editModal.classList.add('hidden'));
editCancelBtn.addEventListener('click',  () => editModal.classList.add('hidden'));
editModal.addEventListener('click', (e) => {
  if (e.target === editModal) editModal.classList.add('hidden');
});

editForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const name = document.getElementById('editName').value;
  const payload = {
    age:            document.getElementById('editAge').value.trim(),
    gender:         document.getElementById('editGender').value,
    city:           document.getElementById('editCity').value.trim(),
    profession:     document.getElementById('editProfession').value.trim(),
    hobby:          document.getElementById('editHobby').value.trim(),
    favoriteColor:  document.getElementById('editFavoriteColor').value.trim(),
    welcomeMessage: document.getElementById('editWelcomeMessage').value.trim(),
  };

  try {
    const res  = await fetch(`/api/users/${encodeURIComponent(name)}`, {
      method:  'PUT',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(payload),
    });
    const data = await res.json();
    if (data.success) {
      showToast(`✅ ${name}'s profile updated!`, 'success');
      editModal.classList.add('hidden');
      await loadUsers();
    } else {
      showToast(`Error: ${data.error}`, 'error');
    }
  } catch (err) {
    showToast(`Network error: ${err.message}`, 'error');
  }
});

// ── Delete Modal ──────────────────────────────────────────────────────────────
const deleteModal   = document.getElementById('deleteModal');
const deleteConfirm = document.getElementById('deleteConfirm');
const deleteCancel  = document.getElementById('deleteCancel');
const deleteWarningText = document.getElementById('deleteWarningText');

function openDeleteModal(name) {
  pendingDeleteName = name;
  deleteWarningText.textContent =
    `Delete "${name}"? This will permanently remove the profile photo, profile data, and face embedding. This cannot be undone.`;
  deleteModal.classList.remove('hidden');
}

deleteCancel.addEventListener('click',  () => deleteModal.classList.add('hidden'));
deleteModal.addEventListener('click', (e) => {
  if (e.target === deleteModal) deleteModal.classList.add('hidden');
});

deleteConfirm.addEventListener('click', async () => {
  if (!pendingDeleteName) return;
  const name = pendingDeleteName;
  deleteConfirm.disabled = true;
  deleteConfirm.textContent = 'Deleting…';

  try {
    const res  = await fetch(`/api/users/${encodeURIComponent(name)}`, { method: 'DELETE' });
    const data = await res.json();
    if (data.success) {
      showToast(`🗑️ ${name} deleted.`, 'info');
      deleteModal.classList.add('hidden');
      await loadUsers();
    } else {
      showToast(`Error: ${data.error}`, 'error');
    }
  } catch (err) {
    showToast(`Network error: ${err.message}`, 'error');
  } finally {
    deleteConfirm.disabled = false;
    deleteConfirm.textContent = '🗑️ Delete';
    pendingDeleteName = null;
  }
});

// ── Toast ─────────────────────────────────────────────────────────────────────
function showToast(message, type = 'info', duration = 4000) {
  const container = document.getElementById('toastContainer');
  const toast     = document.createElement('div');
  const icons     = { success: '✅', error: '❌', info: 'ℹ️' };
  toast.className = `toast toast-${type}`;
  toast.innerHTML = `<span class="toast-icon">${icons[type] || 'ℹ️'}</span>
                     <span class="toast-msg">${message}</span>`;
  container.appendChild(toast);
  setTimeout(() => {
    toast.style.opacity   = '0';
    toast.style.transform = 'translateX(40px)';
    toast.style.transition = 'all 0.3s ease';
    setTimeout(() => toast.remove(), 300);
  }, duration);
}

// ── Utility: HTML escape ──────────────────────────────────────────────────────
function escapeHtml(str) {
  if (str == null) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
