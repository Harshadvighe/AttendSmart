function showToast(message, type = 'error') {
  const container = document.getElementById('toastContainer');
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.innerHTML = `<div class="toast-icon">${type === 'success' ? '✅' : '❌'}</div><div>${message}</div>`;
  container.appendChild(toast);
  setTimeout(() => toast.remove(), 4000);
}

// Tab switcher
function switchTab(tabName) {
  document.querySelectorAll('.admin-tab').forEach(btn => btn.classList.remove('active'));
  document.querySelectorAll('.tab-content').forEach(content => content.style.display = 'none');
  
  event.target.classList.add('active');
  document.getElementById(`tab-${tabName}`).style.display = 'block';

  if (tabName === 'teachers') loadTeachers();
  if (tabName === 'classes') {
    loadClasses();
    loadTeachersDropdown();
  }
}

// Load teachers list
async function loadTeachers() {
  try {
    const response = await fetch('/api/admin/teachers');
    const data = await response.json();
    const tbody = document.getElementById('teachersListBody');
    
    if (data.success) {
      if (data.teachers.length === 0) {
        tbody.innerHTML = '<tr><td colspan="3" style="text-align: center; padding: 1.5rem; color: var(--txt-muted);">No teacher accounts created.</td></tr>';
        return;
      }
      
      let html = '';
      data.teachers.forEach(t => {
        html += `
          <tr style="border-bottom: 1px solid var(--clr-border);">
            <td style="padding: 0.75rem;">${t.name}</td>
            <td style="padding: 0.75rem;">${t.username}</td>
            <td style="padding: 0.75rem; text-align: right;">
              <button class="btn btn-sm action-btn-danger" onclick="deleteTeacher('${t.username}')">Delete</button>
            </td>
          </tr>
        `;
      });
      tbody.innerHTML = html;
    }
  } catch (err) {
    showToast('Failed to load teachers list');
  }
}

// Add a teacher
async function handleAddTeacher(e) {
  e.preventDefault();
  const name = document.getElementById('teacherName').value.trim();
  const username = document.getElementById('teacherUsername').value.trim();
  const password = document.getElementById('teacherPassword').value;

  try {
    const response = await fetch('/api/admin/teachers', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, username, password })
    });
    const res = await response.json();
    if (res.success) {
      showToast('Teacher account created successfully!', 'success');
      document.getElementById('addTeacherForm').reset();
      loadTeachers();
    } else {
      showToast(res.error || 'Failed to add teacher');
    }
  } catch (err) {
    showToast('Error adding teacher');
  }
}

// Delete a teacher
async function deleteTeacher(username) {
  if (!confirm(`Are you sure you want to delete teacher account "${username}"?`)) return;
  try {
    const response = await fetch(`/api/admin/teachers/${username}`, { method: 'DELETE' });
    const res = await response.json();
    if (res.success) {
      showToast('Teacher deleted', 'success');
      loadTeachers();
    } else {
      showToast(res.error || 'Failed to delete teacher');
    }
  } catch (err) {
    showToast('Error deleting teacher');
  }
}

// Load classes and their assigned teachers
async function loadClasses() {
  try {
    const classesResponse = await fetch('/api/classes');
    const classesData = await classesResponse.json();
    const teachersResponse = await fetch('/api/admin/teachers');
    const teachersData = await teachersResponse.json();
    const tbody = document.getElementById('classesListBody');

    if (classesData.success && teachersData.success) {
      if (classesData.classes.length === 0) {
        tbody.innerHTML = '<tr><td colspan="3" style="text-align: center; padding: 1.5rem; color: var(--txt-muted);">No classes created.</td></tr>';
        return;
      }

      let html = '';
      classesData.classes.forEach(c => {
        // Find assigned teacher
        const assignedTeacher = teachersData.teachers.find(t => t.assigned_classes && t.assigned_classes.includes(c.id));
        const teacherLabel = assignedTeacher 
          ? `<span class="badge badge-success">${assignedTeacher.name}</span> <button class="btn btn-sm btn-ghost" onclick="unassignClass('${assignedTeacher.username}', '${c.id}')" title="Unassign">✕</button>`
          : '<span class="badge badge-ghost" style="color:var(--txt-muted);">Unassigned</span>';

        html += `
          <tr style="border-bottom: 1px solid var(--clr-border);">
            <td style="padding: 0.75rem;"><strong>${c.subject}</strong> (${c.class || ''}-${c.div || ''})</td>
            <td style="padding: 0.75rem;">${teacherLabel}</td>
            <td style="padding: 0.75rem; text-align: right;">
              <button class="btn btn-sm btn-primary" onclick="openAssignModal('${c.id}')">Assign</button>
              <button class="btn btn-sm action-btn-danger" style="margin-left:0.25rem;" onclick="deleteClass('${c.id}')">Delete</button>
            </td>
          </tr>
        `;
      });
      tbody.innerHTML = html;
    }
  } catch (err) {
    showToast('Failed to load classes and assignments');
  }
}

// Add a class
async function handleAddClass(e) {
  e.preventDefault();
  const subject = document.getElementById('classSubject').value.trim();
  const className = document.getElementById('classClass').value.trim();
  const division = document.getElementById('classDiv').value.trim();

  try {
    const response = await fetch('/api/classes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ subject, class: className, div: division })
    });
    const res = await response.json();
    if (res.success) {
      showToast('Class created successfully!', 'success');
      document.getElementById('addClassForm').reset();
      loadClasses();
    } else {
      showToast(res.error || 'Failed to create class');
    }
  } catch (err) {
    showToast('Error creating class');
  }
}

// Delete a class
async function deleteClass(classId) {
  if (!confirm(`Are you sure you want to delete class "${classId}"?`)) return;
  try {
    const response = await fetch(`/api/classes/${classId}`, { method: 'DELETE' });
    const res = await response.json();
    if (res.success) {
      showToast('Class deleted', 'success');
      loadClasses();
    } else {
      showToast(res.error || 'Failed to delete class');
    }
  } catch (err) {
    showToast('Error deleting class');
  }
}

// Populate teachers select dropdown
async function loadTeachersDropdown() {
  try {
    const response = await fetch('/api/admin/teachers');
    const data = await response.json();
    const select = document.getElementById('teacherSelect');
    
    if (data.success) {
      let html = '<option value="">Select a teacher...</option>';
      data.teachers.forEach(t => {
        html += `<option value="${t.username}">${t.name} (${t.username})</option>`;
      });
      select.innerHTML = html;
    }
  } catch (err) {}
}

function openAssignModal(classId) {
  document.getElementById('assignClassId').value = classId;
  document.getElementById('assignModal').classList.remove('hidden');
}

function closeAssignModal() {
  document.getElementById('assignModal').classList.add('hidden');
}

async function handleAssign(e) {
  e.preventDefault();
  const classId = document.getElementById('assignClassId').value;
  const username = document.getElementById('teacherSelect').value;

  try {
    const response = await fetch('/api/admin/assign_class', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, classId })
    });
    const res = await response.json();
    if (res.success) {
      showToast('Teacher assigned successfully', 'success');
      closeAssignModal();
      loadClasses();
    } else {
      showToast(res.error || 'Failed to assign teacher');
    }
  } catch (err) {
    showToast('Error assigning teacher');
  }
}

async function unassignClass(username, classId) {
  if (!confirm(`Are you sure you want to unassign this class from ${username}?`)) return;
  try {
    const response = await fetch('/api/admin/unassign_class', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, classId })
    });
    const res = await response.json();
    if (res.success) {
      showToast('Assignment removed', 'success');
      loadClasses();
    } else {
      showToast(res.error || 'Failed to unassign class');
    }
  } catch (err) {
    showToast('Error unassigning class');
  }
}

document.addEventListener('DOMContentLoaded', () => {
  loadTeachers();
  
  // Theme Toggle
  (function () {
    const btn = document.getElementById("themeToggle");
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
});
