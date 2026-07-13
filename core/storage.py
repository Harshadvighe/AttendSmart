"""
storage.py - File system utilities for the Smart Student Attendance System.
Manages saving/loading of student profiles, photos, embeddings, attendance records,
and class configurations — all as JSON/NPY files (no database required).
"""

import os
import json
import shutil
import numpy as np
from pathlib import Path
from datetime import date, datetime
from werkzeug.security import generate_password_hash, check_password_hash

# ─── Base Paths ────────────────────────────────────────────────────────────────
BASE_DIR        = Path(__file__).resolve().parent.parent
DATA_DIR        = BASE_DIR / "data"
PEOPLE_DIR      = DATA_DIR / "people"        # student profiles & photos
EMBEDDINGS_DIR  = DATA_DIR / "embeddings"   # face embeddings .npy
ATTENDANCE_DIR  = DATA_DIR / "attendance"   # daily attendance JSON
CLASSES_FILE    = DATA_DIR / "classes.json" # subject / class config
TEACHERS_FILE   = DATA_DIR / "teachers.json" # teacher accounts config


def ensure_dirs():
    """Create all data directories if they don't exist."""
    PEOPLE_DIR.mkdir(parents=True, exist_ok=True)
    EMBEDDINGS_DIR.mkdir(parents=True, exist_ok=True)
    ATTENDANCE_DIR.mkdir(parents=True, exist_ok=True)

    # Initialize default admin teacher if not exists
    if not TEACHERS_FILE.exists():
        with open(TEACHERS_FILE, "w", encoding="utf-8") as f:
            json.dump({
                "admin": {
                    "password_hash": generate_password_hash("admin"),
                    "name": "Admin Teacher",
                    "role": "admin",
                    "assigned_classes": []
                }
            }, f, indent=2)

# ─── Authentication ───────────────────────────────────────────────────────────
def authenticate_teacher(username: str, password: str) -> dict | None:
    """Verify teacher credentials. Returns teacher profile or None."""
    ensure_dirs()
    try:
        with open(TEACHERS_FILE, "r", encoding="utf-8") as f:
            teachers = json.load(f)
        teacher = teachers.get(username)
        if teacher and check_password_hash(teacher.get("password_hash", ""), password):
            return {
                "username": username,
                "name": teacher.get("name", "Teacher"),
                "role": teacher.get("role", "teacher"),
                "assigned_classes": teacher.get("assigned_classes", [])
            }
    except Exception:
        pass
    return None

def list_all_teachers() -> list[dict]:
    """List all teachers from teachers.json."""
    ensure_dirs()
    if not TEACHERS_FILE.exists():
        return []
    try:
        with open(TEACHERS_FILE, "r", encoding="utf-8") as f:
            teachers = json.load(f)
        result = []
        for username, data in teachers.items():
            result.append({
                "username": username,
                "name": data.get("name", ""),
                "role": data.get("role", "teacher"),
                "assigned_classes": data.get("assigned_classes", [])
            })
        return result
    except Exception:
        return []

def add_teacher(username: str, password_plain: str, name: str, role: str = "teacher") -> bool:
    """Add a new teacher account. Returns False if username exists."""
    ensure_dirs()
    try:
        with open(TEACHERS_FILE, "r", encoding="utf-8") as f:
            teachers = json.load(f)
        if username in teachers:
            return False
        teachers[username] = {
            "password_hash": generate_password_hash(password_plain),
            "name": name,
            "role": role,
            "assigned_classes": []
        }
        with open(TEACHERS_FILE, "w", encoding="utf-8") as f:
            json.dump(teachers, f, indent=2, ensure_ascii=False)
        return True
    except Exception:
        return False

def delete_teacher(username: str) -> bool:
    """Delete a teacher account. Returns False if username does not exist."""
    ensure_dirs()
    try:
        with open(TEACHERS_FILE, "r", encoding="utf-8") as f:
            teachers = json.load(f)
        if username not in teachers or username == "admin":
            return False
        del teachers[username]
        with open(TEACHERS_FILE, "w", encoding="utf-8") as f:
            json.dump(teachers, f, indent=2, ensure_ascii=False)
        return True
    except Exception:
        return False

def assign_class_to_teacher(username: str, class_id: str) -> bool:
    """Assign a class ID to a teacher."""
    ensure_dirs()
    try:
        with open(TEACHERS_FILE, "r", encoding="utf-8") as f:
            teachers = json.load(f)
        if username not in teachers:
            return False
        classes = teachers[username].get("assigned_classes", [])
        if class_id not in classes:
            classes.append(class_id)
            teachers[username]["assigned_classes"] = classes
            with open(TEACHERS_FILE, "w", encoding="utf-8") as f:
                json.dump(teachers, f, indent=2, ensure_ascii=False)
        return True
    except Exception:
        return False

def unassign_class_from_teacher(username: str, class_id: str) -> bool:
    """Remove a class ID assignment from a teacher."""
    ensure_dirs()
    try:
        with open(TEACHERS_FILE, "r", encoding="utf-8") as f:
            teachers = json.load(f)
        if username not in teachers:
            return False
        classes = teachers[username].get("assigned_classes", [])
        if class_id in classes:
            classes.remove(class_id)
            teachers[username]["assigned_classes"] = classes
            with open(TEACHERS_FILE, "w", encoding="utf-8") as f:
                json.dump(teachers, f, indent=2, ensure_ascii=False)
        return True
    except Exception:
        return False

def authenticate_student(student_id: str, password: str) -> dict | None:
    """Verify student credentials. Returns student profile dict or None."""
    ensure_dirs()
    for name in list_all_people():
        profile = load_profile(name)
        if profile and profile.get("studentId") == student_id:
            stored_hash = profile.get("password_hash")
            if stored_hash and check_password_hash(stored_hash, password):
                return {"username": student_id, "name": name, "profile": profile}
            elif profile.get("password") == password:  # fallback for unhashed ones if any
                return {"username": student_id, "name": name, "profile": profile}
    return None


# ─── Student Profile Management ───────────────────────────────────────────────
def save_profile(name: str, profile_data: dict, image_bytes: bytes) -> bool:
    """
    Save a student's JSON profile and profile photo.
    Returns True on success.
    """
    ensure_dirs()
    # Hash password if plain password is provided in registration
    if "password" in profile_data:
        plain_password = profile_data.pop("password")
        profile_data["password_hash"] = generate_password_hash(plain_password)

    person_dir = PEOPLE_DIR / name
    person_dir.mkdir(parents=True, exist_ok=True)

    # Write profile JSON
    with open(person_dir / "profile.json", "w", encoding="utf-8") as f:
        json.dump(profile_data, f, indent=2, ensure_ascii=False)

    # Write profile photo
    with open(person_dir / "profile.jpg", "wb") as f:
        f.write(image_bytes)

    return True


def load_profile(name: str) -> dict | None:
    """Load a student's profile JSON. Returns None if not found."""
    profile_path = PEOPLE_DIR / name / "profile.json"
    if not profile_path.exists():
        return None
    with open(profile_path, "r", encoding="utf-8") as f:
        return json.load(f)


def get_profile_photo_path(name: str) -> Path | None:
    """Return the Path to the student's profile photo, or None if missing."""
    path = PEOPLE_DIR / name / "profile.jpg"
    return path if path.exists() else None


def list_all_people() -> list[str]:
    """Return sorted list of all enrolled student names."""
    ensure_dirs()
    return sorted([d.name for d in PEOPLE_DIR.iterdir() if d.is_dir()])


def delete_person(name: str) -> bool:
    """Delete a student's folder (photo + JSON) and their embedding file."""
    person_dir  = PEOPLE_DIR / name
    emb_path    = EMBEDDINGS_DIR / f"{name}.npy"

    if not person_dir.exists():
        return False

    shutil.rmtree(person_dir)
    if emb_path.exists():
        emb_path.unlink()
    return True


def person_exists(name: str) -> bool:
    """Check whether a student with this name is already enrolled."""
    return (PEOPLE_DIR / name).exists()


def update_profile(name: str, updated_data: dict) -> bool:
    """Update a student's profile JSON fields (excluding name)."""
    profile_path = PEOPLE_DIR / name / "profile.json"
    if not profile_path.exists():
        return False
    with open(profile_path, "r", encoding="utf-8") as f:
        current = json.load(f)
    current.update(updated_data)
    with open(profile_path, "w", encoding="utf-8") as f:
        json.dump(current, f, indent=2, ensure_ascii=False)
    return True


# ─── Embedding Management ──────────────────────────────────────────────────────
def save_embedding(name: str, embedding: np.ndarray) -> None:
    """Save a face embedding vector as a .npy file."""
    ensure_dirs()
    np.save(str(EMBEDDINGS_DIR / f"{name}.npy"), embedding)


def load_embedding(name: str) -> np.ndarray | None:
    """Load a face embedding vector. Returns None if not found."""
    emb_path = EMBEDDINGS_DIR / f"{name}.npy"
    if not emb_path.exists():
        return None
    return np.load(str(emb_path))


def load_all_embeddings() -> dict[str, np.ndarray]:
    """Load all stored embeddings into a dict {name: embedding_array}."""
    ensure_dirs()
    embeddings = {}
    for emb_file in EMBEDDINGS_DIR.glob("*.npy"):
        embeddings[emb_file.stem] = np.load(str(emb_file))
    return embeddings


# ─── Class / Subject Management ───────────────────────────────────────────────
def load_classes() -> list[dict]:
    """Load the list of class/subject configs from classes.json."""
    if not CLASSES_FILE.exists():
        return []
    with open(CLASSES_FILE, "r", encoding="utf-8") as f:
        return json.load(f)


def save_classes(classes: list[dict]) -> None:
    """Persist the class/subject config list."""
    ensure_dirs()
    with open(CLASSES_FILE, "w", encoding="utf-8") as f:
        json.dump(classes, f, indent=2, ensure_ascii=False)


def get_class_by_id(class_id: str) -> dict | None:
    """Fetch a single class config by its id field."""
    for c in load_classes():
        if c.get("id") == class_id:
            return c
    return None


def add_class(class_data: dict) -> bool:
    """Add a new class/subject config. Returns False if id already exists."""
    classes = load_classes()
    if any(c.get("id") == class_data.get("id") for c in classes):
        return False
    classes.append(class_data)
    save_classes(classes)
    return True


def delete_class(class_id: str) -> bool:
    """Delete a class config by id. Returns False if not found."""
    classes = load_classes()
    new = [c for c in classes if c.get("id") != class_id]
    if len(new) == len(classes):
        return False
    save_classes(new)
    return True


# ─── Attendance Session Management ────────────────────────────────────────────
def _session_path(session_date: str, class_id: str) -> Path:
    """Return the Path for an attendance session JSON file."""
    day_dir = ATTENDANCE_DIR / session_date
    day_dir.mkdir(parents=True, exist_ok=True)
    return day_dir / f"{class_id}.json"


def save_attendance_session(session: dict) -> None:
    """
    Persist an attendance session.
    session must have keys: date (YYYY-MM-DD), classId, records (list).
    """
    path = _session_path(session["date"], session["classId"])
    with open(path, "w", encoding="utf-8") as f:
        json.dump(session, f, indent=2, ensure_ascii=False)


def load_attendance_session(session_date: str, class_id: str) -> dict | None:
    """Load an attendance session JSON. Returns None if not found."""
    path = _session_path(session_date, class_id)
    if not path.exists():
        return None
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)


def list_sessions_for_date(session_date: str) -> list[dict]:
    """Return all attendance sessions for a given date (YYYY-MM-DD)."""
    day_dir = ATTENDANCE_DIR / session_date
    if not day_dir.exists():
        return []
    sessions = []
    for f in day_dir.glob("*.json"):
        with open(f, "r", encoding="utf-8") as fp:
            sessions.append(json.load(fp))
    return sessions


def list_all_sessions() -> list[dict]:
    """Return all attendance sessions across all dates (newest first)."""
    sessions = []
    if not ATTENDANCE_DIR.exists():
        return sessions
    for day_dir in sorted(ATTENDANCE_DIR.iterdir(), reverse=True):
        if day_dir.is_dir():
            for f in day_dir.glob("*.json"):
                with open(f, "r", encoding="utf-8") as fp:
                    sessions.append(json.load(fp))
    return sessions


def get_student_attendance_summary(student_name: str) -> dict:
    """
    Return a summary of attendance for a specific student across all sessions.
    Returns: {total_sessions, present, absent, late, pct}
    """
    all_sessions = list_all_sessions()
    total = present = absent = late = 0

    for session in all_sessions:
        for record in session.get("records", []):
            if record.get("name") == student_name:
                total += 1
                status = record.get("status", "absent")
                if status == "present":
                    present += 1
                elif status == "late":
                    late += 1
                else:
                    absent += 1

    pct = round((present + late) / total * 100, 1) if total > 0 else 0
    return {"total": total, "present": present, "absent": absent, "late": late, "pct": pct}


def get_today_summary() -> dict:
    """Return a summary of today's attendance across all classes."""
    today = date.today().strftime("%Y-%m-%d")
    sessions = list_sessions_for_date(today)
    students = list_all_people()
    total_students = len(students)

    total_present = 0
    total_records = 0
    class_summaries = []

    for session in sessions:
        records = session.get("records", [])
        present = sum(1 for r in records if r.get("status") in ("present", "late"))
        total_present += present
        total_records += len(records)
        class_summaries.append({
            "classId":  session.get("classId"),
            "subject":  session.get("subject"),
            "section":  session.get("section"),
            "teacher":  session.get("teacher"),
            "total":    len(records),
            "present":  present,
            "absent":   len(records) - present,
            "pct":      round(present / len(records) * 100, 1) if records else 0,
            "startTime": session.get("startTime"),
            "endTime":   session.get("endTime"),
            "active":    session.get("active", False),
        })

    return {
        "date":           today,
        "sessions":       len(sessions),
        "totalStudents":  total_students,
        "totalPresent":   total_present,
        "classSummaries": class_summaries,
    }
