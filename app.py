"""
# NOTE: /users redirects to /students for backwards compatibility
app.py - Smart Student Attendance System (Flask backend).

Routes:
    GET  /              → Attendance dashboard
    GET  /register      → Student enrollment page
    GET  /students      → Student directory
    GET  /attend        → Live attendance marking
    GET  /reports       → Attendance reports

    POST /api/register              → Enroll a new student
    POST /api/recognize             → Face recognition (used during attendance)
    GET  /api/students              → List all students
    GET  /api/students/<name>/photo → Student profile photo
    PUT  /api/students/<name>       → Update student profile
    DELETE /api/students/<name>     → Delete student

    GET  /api/classes               → List all class configs
    POST /api/classes               → Create a class config
    DELETE /api/classes/<id>        → Delete a class config

    POST /api/attendance/start      → Start an attendance session
    POST /api/attendance/mark       → Mark a student present (via face)
    POST /api/attendance/manual     → Manually toggle a student's status
    POST /api/attendance/end        → End session, finalise absences
    GET  /api/attendance/session    → Get current active session state
    GET  /api/attendance/today      → Today's attendance summary
    GET  /api/attendance/records    → Filtered records for reports
    GET  /api/attendance/export     → CSV export of filtered records

    GET  /api/stats                 → App statistics
"""

import os
import io
import csv
import json
import time
import threading
import functools
from pathlib import Path
from datetime import date, datetime

from flask import Flask, request, jsonify, render_template, send_file, abort, Response, session, redirect, url_for
from flask_cors import CORS

from core import storage, recognition

app  = Flask(__name__)
app.secret_key = "super_secret_key_for_attendance_system" # Use env var in production
CORS(app)

# ─── Global State ──────────────────────────────────────────────────────────────
_embeddings_cache: dict = {}
_cache_lock = threading.Lock()
_active_sessions: dict = {}
_session_lock = threading.Lock()

# ─── Auth Decorators ──────────────────────────────────────────────────────────
def login_required(f):
    @functools.wraps(f)
    def decorated_function(*args, **kwargs):
        if "user" not in session:
            if request.path.startswith("/api/"):
                return jsonify({"success": False, "error": "Unauthorized"}), 401
            return redirect(url_for("page_login"))
        return f(*args, **kwargs)
    return decorated_function

def role_required(role):
    def decorator(f):
        @functools.wraps(f)
        def decorated_function(*args, **kwargs):
            if "user" not in session:
                if request.path.startswith("/api/"):
                    return jsonify({"success": False, "error": "Unauthorized"}), 401
                return redirect(url_for("page_login"))
            user_role = session.get("role")
            if user_role != "admin" and user_role != role:
                if request.path.startswith("/api/"):
                    return jsonify({"success": False, "error": "Forbidden"}), 403
                return abort(403)
            return f(*args, **kwargs)
        return decorated_function
    return decorator


def _refresh_cache():
    global _embeddings_cache
    with _cache_lock:
        _embeddings_cache = storage.load_all_embeddings()


_refresh_cache()


def _initialize_active_sessions():
    global _active_sessions
    with _session_lock:
        all_sessions = storage.list_all_sessions()
        for sess in all_sessions:
            if sess.get("active"):
                _active_sessions[sess["classId"]] = sess


_initialize_active_sessions()


# ─── Page Routes ──────────────────────────────────────────────────────────────
@app.route("/")
@login_required
def index():
    if session.get("role") == "student":
        return redirect(url_for("page_student_dashboard"))
    elif session.get("role") == "admin":
        return redirect(url_for("page_admin"))
    return render_template("index.html")


@app.route("/login")
def page_login():
    if "user" in session:
        return redirect(url_for("index"))
    return render_template("login.html")


@app.route("/logout")
def page_logout():
    session.clear()
    return redirect(url_for("page_login"))


@app.route("/admin")
@login_required
@role_required("admin")
def page_admin():
    return render_template("admin.html")


@app.route("/student_dashboard")
@login_required
@role_required("student")
def page_student_dashboard():
    return render_template("student_dashboard.html")


@app.route("/student_attend")
@login_required
@role_required("student")
def page_student_attend():
    return render_template("student_attend.html")


@app.route("/register")
@login_required
@role_required("admin")
def register_page():
    return render_template("register.html")


@app.route("/students")
@login_required
@role_required("admin")
def students_page():
    return render_template("students.html")


@app.route("/attend")
@login_required
@role_required("teacher")
def attend_page():
    return render_template("attend.html")


@app.route("/users")
@login_required
def users_redirect():
    """Backwards-compat redirect from old /users → /students."""
    return redirect("/students")


@app.route("/reports")
@login_required
@role_required("teacher")
def reports_page():
    return render_template("reports.html")


# ─── API: Authentication ──────────────────────────────────────────────────────
@app.route("/api/login", methods=["POST"])
def api_login():
    data = request.get_json(force=True)
    role = data.get("role", "student")
    username = data.get("username", "").strip()
    password = data.get("password", "")

    if not username or not password:
        return jsonify({"success": False, "error": "Username and password required."}), 400

    if role in ("admin", "teacher"):
        user_info = storage.authenticate_teacher(username, password)
        if user_info:
            session["user"] = user_info["username"]
            session["name"] = user_info["name"]
            session["role"] = user_info["role"]
            return jsonify({"success": True, "redirect": "/"})
    elif role == "student":
        user_info = storage.authenticate_student(username, password)
        if user_info:
            session["user"] = user_info["username"]
            session["name"] = user_info["name"]
            session["role"] = "student"
            return jsonify({"success": True, "redirect": "/student_dashboard"})

    return jsonify({"success": False, "error": "Invalid username or password"}), 401



# ─── API: Student Registration ────────────────────────────────────────────────
@app.route("/api/register", methods=["POST"])
@login_required
@role_required("admin")
def api_register():
    """Enroll a new student with face embedding and profile data."""
    try:
        if request.is_json:
            data      = request.get_json()
            image_b64 = data.get("image", "")
            profile   = {k: v for k, v in data.items() if k != "image"}
        else:
            data      = request.form.to_dict()
            image_b64 = data.pop("image", "")
            profile   = data

        name = profile.get("name", "").strip()
        if not name:
            return jsonify({"success": False, "error": "Name is required."}), 400

        safe_name = "".join(c for c in name if c.isalnum() or c in (" ", "_", "-")).strip()
        if not safe_name:
            return jsonify({"success": False, "error": "Name contains invalid characters."}), 400

        if storage.person_exists(safe_name):
            return jsonify({"success": False, "error": f"A student named '{safe_name}' is already enrolled."}), 409

        # Decode image
        if not image_b64 and "photo" in request.files:
            img_bgr = recognition.decode_image(request.files["photo"].read())
        elif image_b64:
            img_bgr = recognition.decode_image(image_b64)
        else:
            return jsonify({"success": False, "error": "No image provided."}), 400

        # Validate face
        validation = recognition.validate_face(img_bgr)
        if not validation["valid"]:
            return jsonify({"success": False, "error": validation["error"]}), 422

        # Generate embedding
        try:
            embedding = recognition.get_embedding(img_bgr)
        except Exception as e:
            return jsonify({"success": False, "error": f"Could not extract face features: {e}"}), 500

        # Check duplicate face
        with _cache_lock:
            existing = dict(_embeddings_cache)
        duplicate = recognition.check_duplicate_face(embedding, existing)
        if duplicate:
            return jsonify({"success": False,
                            "error": f"This face is already enrolled as '{duplicate}'."}), 409

        # Build profile
        profile_data = {
            "name":         safe_name,
            "studentId":    profile.get("studentId", "").strip(),
            "rollNo":       profile.get("rollNo", "").strip(),
            "class":        profile.get("year", "").strip() or profile.get("class", "").strip(),
            "div":          profile.get("section", "").strip() or profile.get("div", "").strip(),
            "department":   profile.get("department", "").strip(),
            "email":        profile.get("email", "").strip(),
            "phone":        profile.get("phone", "").strip(),
            "password":     profile.get("password", "").strip(),
            "registeredAt": time.strftime("%Y-%m-%d %H:%M:%S"),
        }

        image_bytes = recognition.encode_image_to_bytes(img_bgr)
        storage.save_profile(safe_name, profile_data, image_bytes)
        storage.save_embedding(safe_name, embedding)
        _refresh_cache()

        return jsonify({"success": True, "name": safe_name,
                        "message": f"{safe_name} enrolled successfully!"}), 201

    except Exception as e:
        app.logger.error(f"Registration error: {e}", exc_info=True)
        return jsonify({"success": False, "error": f"Server error: {str(e)}"}), 500


# ─── API: Face Recognition ─────────────────────────────────────────────────────
@app.route("/api/recognize", methods=["POST"])
def api_recognize():
    """Recognize a face in a webcam frame. Returns student profile if matched."""
    try:
        data      = request.get_json(force=True)
        image_b64 = data.get("image", "")
        if not image_b64:
            return jsonify({"success": False, "error": "No image provided."}), 400

        img_bgr = recognition.decode_image(image_b64)

        with _cache_lock:
            current_embeddings = dict(_embeddings_cache)

        result = recognition.recognize_face(img_bgr, current_embeddings)

        if result["recognized"]:
            profile = storage.load_profile(result["name"])
            return jsonify({
                "success":      True,
                "face_detected": True,
                "recognized":   True,
                "name":         result["name"],
                "confidence":   result["confidence"],
                "profile":      profile,
            })
        return jsonify({
            "success":      True,
            "face_detected": result["face_detected"],
            "recognized":   False,
            "name":         None,
            "confidence":   result["confidence"],
            "profile":      None,
        })

    except Exception as e:
        app.logger.error(f"Recognition error: {e}", exc_info=True)
        return jsonify({"success": False, "error": str(e)}), 500


# ─── API: Student Management ──────────────────────────────────────────────────
@app.route("/api/students", methods=["GET"])
def api_list_students():
    """Return all enrolled students with profiles and attendance summaries."""
    people = storage.list_all_people()
    students = []
    for name in people:
        profile = storage.load_profile(name)
        if profile:
            summary = storage.get_student_attendance_summary(name)
            profile["attendancePct"] = summary["pct"]
            profile["attendanceTotal"] = summary["total"]
            students.append(profile)
    return jsonify({"success": True, "students": students, "count": len(students)})


@app.route("/api/students/<name>/photo", methods=["GET"])
def api_student_photo(name: str):
    """Serve a student's profile photo."""
    photo_path = storage.get_profile_photo_path(name)
    if photo_path is None:
        abort(404)
    return send_file(str(photo_path), mimetype="image/jpeg")


@app.route("/api/students/<name>", methods=["PUT"])
def api_update_student(name: str):
    """Update a student's profile fields (does not change name or photo)."""
    if not storage.person_exists(name):
        return jsonify({"success": False, "error": "Student not found."}), 404
    data = request.get_json(force=True)
    data.pop("name", None)
    data.pop("registeredAt", None)
    storage.update_profile(name, data)
    return jsonify({"success": True, "message": f"Profile for {name} updated."})


@app.route("/api/students/<name>", methods=["DELETE"])
def api_delete_student(name: str):
    """Delete a student (profile, photo, embedding)."""
    deleted = storage.delete_person(name)
    if not deleted:
        return jsonify({"success": False, "error": "Student not found."}), 404
    _refresh_cache()
    return jsonify({"success": True, "message": f"'{name}' has been removed."})


# ─── API: Class / Subject Management ─────────────────────────────────────────
@app.route("/api/classes", methods=["GET"])
@login_required
def api_list_classes():
    """Return all class/subject configurations, filtered by teacher assignments."""
    classes = storage.load_classes()
    user_role = str(session.get("role", "")).strip().lower()
    username = str(session.get("user", "")).strip()

    if user_role == "teacher":
        teachers = storage.list_all_teachers()
        teacher_profile = next((t for t in teachers if t["username"].strip().lower() == username.lower()), None)
        assigned = teacher_profile.get("assigned_classes", []) if teacher_profile else []
        classes = [c for c in classes if c.get("id") in assigned]

    return jsonify({"success": True, "classes": classes})


@app.route("/api/classes", methods=["POST"])
def api_create_class():
    """Create a new class/subject configuration."""
    data = request.get_json(force=True)
    required = ["subject", "class", "div"]
    missing = [f for f in required if not data.get(f)]
    if missing:
        return jsonify({"success": False, "error": f"Missing fields: {', '.join(missing)}"}), 400

    subject = data["subject"].strip()
    class_val = data["class"].strip()
    div_val = data["div"].strip()
    unique_id = f"{subject}-{class_val}-{div_val}".lower().replace(" ", "-")

    data["code"] = f"{class_val}-{div_val}"
    data["id"] = unique_id

    if not storage.add_class(data):
        return jsonify({"success": False, "error": "A class with this Subject, Class, and Division already exists."}), 409
    return jsonify({"success": True, "message": "Class created."}), 201


@app.route("/api/classes/<class_id>", methods=["DELETE"])
def api_delete_class(class_id: str):
    """Delete a class configuration."""
    if not storage.delete_class(class_id):
        return jsonify({"success": False, "error": "Class not found."}), 404
    return jsonify({"success": True, "message": "Class deleted."})


# ─── API: Attendance ──────────────────────────────────────────────────────────
@app.route("/api/attendance/start", methods=["POST"])
@login_required
@role_required("teacher")
def api_attendance_start():
    """
    Start a new attendance session for a class.
    Body: {classId, subject, class, div, teacher, passcode, lateAfterMinutes (optional)}
    """
    data     = request.get_json(force=True)
    class_id = data.get("classId", "").strip()
    subject  = data.get("subject", "").strip()
    class_name = data.get("class", "").strip()
    div      = data.get("div", "").strip()
    teacher  = data.get("teacher", "Teacher").strip()
    passcode = data.get("passcode", "").strip()
    late_min = int(data.get("lateAfterMinutes", 10))

    if not class_id or not subject or not class_name or not div:
        return jsonify({"success": False, "error": "classId, subject, class, div required."}), 400

    with _session_lock:
        if class_id in _active_sessions and _active_sessions[class_id].get("active"):
            return jsonify({"success": False,
                            "error": f"An attendance session for {subject} is already active. End it first."}), 409

        today    = date.today().strftime("%Y-%m-%d")
        now_time = datetime.now().strftime("%H:%M:%S")

        # Build roll from all students in this class/div
        all_students = storage.list_all_people()
        records = []
        for name in all_students:
            profile = storage.load_profile(name)
            if profile:
                student_class = profile.get("class", "")
                student_div   = profile.get("div", "")
                if student_class == class_name and (div == "__all__" or student_div == div):
                    records.append({
                        "name":      name,
                        "studentId": profile.get("studentId", ""),
                        "rollNo":    profile.get("rollNo", ""),
                        "status":    "absent",
                        "markedAt":  None,
                    })

        new_session = {
            "classId":          class_id,
            "subject":          subject,
            "class":            class_name,
            "div":              div,
            "teacher":          teacher,
            "passcode":         passcode,
            "date":             today,
            "startTime":        now_time,
            "endTime":          None,
            "active":           True,
            "lateAfterMinutes": late_min,
            "records":          records,
        }
        _active_sessions[class_id] = new_session
        storage.save_attendance_session(new_session)

    return jsonify({"success": True, "session": new_session})


@app.route("/api/attendance/session", methods=["GET"])
@login_required
@role_required("teacher")
def api_attendance_session():
    """Return the current active session state."""
    class_id = request.args.get("class_id", "").strip()
    with _session_lock:
        if class_id:
            session = _active_sessions.get(class_id)
            if session:
                return jsonify({"success": True, "session": session, "active": session.get("active", False)})
            return jsonify({"success": True, "session": None, "active": False})
        else:
            # Return all active sessions if no classId specified
            return jsonify({"success": True, "sessions": list(_active_sessions.values()), "active": len(_active_sessions) > 0})


@app.route("/api/attendance/mark", methods=["POST"])
@login_required
@role_required("teacher")
def api_attendance_mark():
    """
    Mark a student present via face recognition.
    Body: {image: <base64>, classId: str}
    """
    data      = request.get_json(force=True)
    class_id  = data.get("classId", "").strip()
    image_b64 = data.get("image", "")

    if not class_id:
        return jsonify({"success": False, "error": "classId required."}), 400
    if not image_b64:
        return jsonify({"success": False, "error": "No image provided."}), 400

    with _session_lock:
        session = _active_sessions.get(class_id)
        if not session or not session.get("active"):
            return jsonify({"success": False, "error": f"No active session found for {class_id}."}), 400

    try:
        img_bgr = recognition.decode_image(image_b64)
        with _cache_lock:
            current_embeddings = dict(_embeddings_cache)
        result = recognition.recognize_face(img_bgr, current_embeddings)

        if not result["recognized"]:
            return jsonify({
                "success":      True,
                "recognized":   False,
                "face_detected": result["face_detected"],
                "marked":       False,
                "name":         None,
            })

        name = result["name"]
        now  = datetime.now()

        # Strict Class & Div Verification
        profile = storage.load_profile(name)
        student_class = profile.get("class", "") if profile else ""
        student_div = profile.get("div", "") if profile else ""
        session_class = session.get("class", "")
        session_div = session.get("div", "")

        if student_class != session_class or (session_div and session_div != "__all__" and student_div != session_div):
            return jsonify({
                "success":       True,
                "recognized":    True,
                "face_detected": True,
                "marked":        False,
                "alreadyMarked": False,
                "name":          name,
                "status":        "wrong_class",
                "message":       f"Student belongs to {student_class}-{student_div}, not {session_class}-{session_div}.",
                "confidence":    result["confidence"],
            })

        with _session_lock:
            start_str = session.get("startTime", "00:00:00")
            late_min  = session.get("lateAfterMinutes", 10)
            try:
                start_dt = datetime.strptime(f"{session['date']} {start_str}", "%Y-%m-%d %H:%M:%S")
                is_late = (now - start_dt).total_seconds() > late_min * 60
            except Exception:
                is_late = False

            new_status = "late" if is_late else "present"
            already_marked = False

            for rec in session["records"]:
                if rec["name"] == name:
                    if rec["status"] in ("present", "late"):
                        already_marked = True
                    else:
                        rec["status"]   = new_status
                        rec["markedAt"] = now.strftime("%H:%M:%S")
                    break
            else:
                session["records"].append({
                    "name":      name,
                    "studentId": profile.get("studentId", "") if profile else "",
                    "rollNo":    profile.get("rollNo", "") if profile else "",
                    "status":    new_status,
                    "markedAt":  now.strftime("%H:%M:%S"),
                })

            if not already_marked:
                storage.save_attendance_session(session)

        return jsonify({
            "success":      True,
            "recognized":   True,
            "face_detected": True,
            "marked":       not already_marked,
            "alreadyMarked": already_marked,
            "name":         name,
            "status":       new_status,
            "confidence":   result["confidence"],
        })

    except Exception as e:
        app.logger.error(f"Attendance mark error: {e}", exc_info=True)
        return jsonify({"success": False, "error": str(e)}), 500


@app.route("/api/attendance/manual", methods=["POST"])
@login_required
@role_required("teacher")
def api_attendance_manual():
    """
    Manually toggle a student's status in a session.
    Body: {name: str, status: 'present'|'absent'|'late', classId: str}
    """
    data     = request.get_json(force=True)
    name     = data.get("name", "").strip()
    status   = data.get("status", "present")
    class_id = data.get("classId", "").strip()

    if not name or not class_id:
        return jsonify({"success": False, "error": "Name and classId required."}), 400
    if status not in ("present", "absent", "late"):
        return jsonify({"success": False, "error": "Status must be present, absent, or late."}), 400

    with _session_lock:
        session = _active_sessions.get(class_id)
        if not session or not session.get("active"):
            return jsonify({"success": False, "error": f"No active session for {class_id}."}), 400

        found = False
        for rec in session["records"]:
            if rec["name"] == name:
                rec["status"]   = status
                rec["markedAt"] = datetime.now().strftime("%H:%M:%S") if status != "absent" else None
                found = True
                break

        if not found:
            return jsonify({"success": False, "error": "Student not found in session roll."}), 404

        storage.save_attendance_session(session)

    return jsonify({"success": True, "name": name, "status": status})


@app.route("/api/attendance/end", methods=["POST"])
@login_required
@role_required("teacher")
def api_attendance_end():
    """
    End an active session and save it.
    Body: {classId: str}
    """
    global _active_sessions
    data     = request.get_json(force=True)
    class_id = data.get("classId", "").strip()

    if not class_id:
        return jsonify({"success": False, "error": "classId required."}), 400

    with _session_lock:
        session_obj = _active_sessions.get(class_id)
        if not session_obj or not session_obj.get("active"):
            return jsonify({"success": False, "error": f"No active session for {class_id}."}), 400

        # Enforce that only the teacher who started the session (or admin) can end it
        session_teacher = session_obj.get("teacher", "").strip().lower()
        current_user_name = session.get("name", "").strip().lower()
        current_user_role = session.get("role", "").strip().lower()

        if current_user_role != "admin" and session_teacher != current_user_name:
            return jsonify({"success": False, "error": "You are not authorized to end this session."}), 403

        session_obj["active"]  = False
        session_obj["endTime"] = datetime.now().strftime("%H:%M:%S")
        
        # Save to disk
        storage.save_attendance_session(session_obj)
        # Remove from active dict
        del _active_sessions[class_id]

    present = sum(1 for r in session_obj["records"] if r["status"] in ("present", "late"))
    total   = len(session_obj["records"])

    return jsonify({
        "success": True,
        "message": f"Session ended. {present}/{total} students marked present.",
        "present": present,
        "total":   total,
    })


@app.route("/api/attendance/today", methods=["GET"])
@login_required
@role_required("teacher")
def api_attendance_today():
    """Return summary of all sessions today (both ended and currently active)."""
    summary = storage.get_today_summary()
    
    # Mix in currently active sessions to the summaries so dashboard shows live updates
    with _session_lock:
        for sid, sess in _active_sessions.items():
            total = len(sess["records"])
            pres  = sum(1 for r in sess["records"] if r["status"] in ("present", "late"))
            abs_c = sum(1 for r in sess["records"] if r["status"] == "absent")
            pct   = round((pres / total * 100) if total > 0 else 0)

            summary["classSummaries"].insert(0, {
                "classId":   sess["classId"],
                "subject":   sess["subject"],
                "class":     sess.get("class", ""),
                "div":       sess.get("div", ""),
                "section":   f"{sess.get('class', '')}-{sess.get('div', '')}",
                "teacher":   sess["teacher"],
                "startTime": sess["startTime"],
                "endTime":   sess["endTime"],
                "active":    sess["active"],
                "total":     total,
                "present":   pres,
                "absent":    abs_c,
                "pct":       pct
            })
            
            summary["sessions"] += 1
            summary["totalPresent"] += pres

        # Active session flag just means ANY session is active
        summary["activeSession"] = len(_active_sessions) > 0

    return jsonify({"success": True, **summary})


@app.route("/api/attendance/records", methods=["GET"])
@login_required
@role_required("teacher")
def api_attendance_records():
    """
    Return filtered attendance records.
    Query params: date_from, date_to, class_id, student_name
    """
    date_from   = request.args.get("date_from", "")
    date_to     = request.args.get("date_to", "")
    class_id    = request.args.get("class_id", "")
    student_name = request.args.get("student_name", "")

    all_sessions = storage.list_all_sessions()
    results = []

    for session in all_sessions:
        s_date = session.get("date", "")
        if date_from and s_date < date_from:
            continue
        if date_to and s_date > date_to:
            continue
        if class_id and session.get("classId") != class_id:
            continue

        for rec in session.get("records", []):
            if student_name and student_name.lower() not in rec.get("name", "").lower():
                continue
            results.append({
                "date":      s_date,
                "classId":   session.get("classId"),
                "subject":   session.get("subject"),
                "class":     session.get("class", ""),
                "div":       session.get("div", ""),
                "section":   session.get("section") or f"{session.get('class', '')}-{session.get('div', '')}",
                "teacher":   session.get("teacher"),
                "startTime": session.get("startTime"),
                "name":      rec.get("name"),
                "studentId": rec.get("studentId"),
                "rollNo":    rec.get("rollNo"),
                "status":    rec.get("status"),
                "markedAt":  rec.get("markedAt"),
            })

    return jsonify({"success": True, "records": results, "count": len(results)})


@app.route("/api/attendance/export", methods=["GET"])
@login_required
@role_required("teacher")
def api_attendance_export():
    """Export filtered attendance records as CSV."""
    date_from    = request.args.get("date_from", "")
    date_to      = request.args.get("date_to", "")
    class_id     = request.args.get("class_id", "")
    student_name = request.args.get("student_name", "")

    # Reuse records logic
    all_sessions = storage.list_all_sessions()
    rows = []

    for session in all_sessions:
        s_date = session.get("date", "")
        if date_from and s_date < date_from:
            continue
        if date_to and s_date > date_to:
            continue
        if class_id and session.get("classId") != class_id:
            continue
        for rec in session.get("records", []):
            if student_name and student_name.lower() not in rec.get("name", "").lower():
                continue
            rows.append({
                "Date":       s_date,
                "Subject":    session.get("subject"),
                "Class":      session.get("class", ""),
                "Div":        session.get("div", ""),
                "Teacher":    session.get("teacher"),
                "Start Time": session.get("startTime"),
                "Student ID": rec.get("studentId"),
                "Name":       rec.get("name"),
                "Roll No":    rec.get("rollNo"),
                "Status":     rec.get("status", "absent").capitalize(),
                "Marked At":  rec.get("markedAt") or "—",
            })

    # Build CSV in memory
    output = io.StringIO()
    fields = ["Date", "Subject", "Class", "Div", "Teacher", "Start Time",
              "Student ID", "Name", "Roll No", "Status", "Marked At"]
    writer = csv.DictWriter(output, fieldnames=fields)
    writer.writeheader()
    writer.writerows(rows)

    csv_bytes = output.getvalue().encode("utf-8-sig")
    filename  = f"attendance_{date.today().strftime('%Y%m%d')}.csv"

    return Response(
        csv_bytes,
        mimetype="text/csv",
        headers={"Content-Disposition": f"attachment; filename={filename}"},
    )


# ─── API: Edit Attendance Record ──────────────────────────────────────────────
@app.route("/api/attendance/record", methods=["PUT"])
@login_required
@role_required("teacher")
def api_edit_attendance_record():
    """
    Edit a specific student's status in a past (saved) attendance session.

    Body: {
        date:     "YYYY-MM-DD",
        classId:  "<class-id>",
        name:     "<student name>",
        status:   "present" | "absent" | "late",
        markedAt: "HH:MM:SS"  (optional)
    }
    """
    data      = request.get_json(force=True)
    sess_date = data.get("date", "").strip()
    class_id  = data.get("classId", "").strip()
    name      = data.get("name", "").strip()
    status    = data.get("status", "").strip()
    marked_at = data.get("markedAt", None)

    if not all([sess_date, class_id, name, status]):
        return jsonify({"success": False, "error": "date, classId, name, and status are required."}), 400
    if status not in ("present", "absent", "late"):
        return jsonify({"success": False, "error": "Status must be 'present', 'absent', or 'late'."}), 400

    session = storage.load_attendance_session(sess_date, class_id)
    if not session:
        return jsonify({"success": False, "error": "Attendance session not found."}), 404

    found = False
    for rec in session.get("records", []):
        if rec["name"] == name:
            old_status      = rec.get("status", "absent")
            rec["status"]   = status
            rec["markedAt"] = (
                marked_at
                if marked_at
                else (datetime.now().strftime("%H:%M:%S") if status != "absent" else None)
            )
            found = True
            break

    if not found:
        return jsonify({"success": False, "error": f"Student '{name}' not found in this session."}), 404

    storage.save_attendance_session(session)
    return jsonify({
        "success": True,
        "message": f"{name} updated to '{status}'.",
        "name":    name,
        "status":  status,
    })


# ─── API: Stats ────────────────────────────────────────────────────────────────
@app.route("/api/stats", methods=["GET"])
@login_required
@role_required("teacher")
def api_stats():
    """Return app statistics."""
    with _cache_lock:
        count = len(_embeddings_cache)
    today_summary = storage.get_today_summary()
    return jsonify({
        "success":           True,
        "enrolled_students": count,
        "sessions_today":    today_summary["sessions"],
        "present_today":     today_summary["totalPresent"],
        "model":             "YuNet + SFace (OpenCV ONNX)",
    })


# ─── API: Admin Teacher & Class Management ────────────────────────────────────
@app.route("/api/admin/teachers", methods=["GET"])
@login_required
@role_required("admin")
def api_admin_teachers():
    teachers = storage.list_all_teachers()
    # Filter out admin
    teachers = [t for t in teachers if t["role"] != "admin"]
    return jsonify({"success": True, "teachers": teachers})


@app.route("/api/admin/teachers", methods=["POST"])
@login_required
@role_required("admin")
def api_admin_add_teacher():
    data = request.get_json(force=True)
    username = data.get("username", "").strip()
    password = data.get("password", "").strip()
    name = data.get("name", "").strip()

    if not username or not password or not name:
        return jsonify({"success": False, "error": "All fields are required."}), 400

    if storage.add_teacher(username, password, name):
        return jsonify({"success": True, "message": "Teacher account created."}), 201
    return jsonify({"success": False, "error": "Username already exists."}), 409


@app.route("/api/admin/teachers/<username>", methods=["DELETE"])
@login_required
@role_required("admin")
def api_admin_delete_teacher(username: str):
    if storage.delete_teacher(username):
        return jsonify({"success": True, "message": "Teacher account deleted."})
    return jsonify({"success": False, "error": "Teacher not found or cannot be deleted."}), 404


@app.route("/api/admin/assign_class", methods=["POST"])
@login_required
@role_required("admin")
def api_admin_assign_class():
    data = request.get_json(force=True)
    username = data.get("username", "").strip()
    class_id = data.get("classId", "").strip()

    if not username or not class_id:
        return jsonify({"success": False, "error": "Username and classId required."}), 400

    if storage.assign_class_to_teacher(username, class_id):
        return jsonify({"success": True, "message": f"Class assigned to {username}."})
    return jsonify({"success": False, "error": "Failed to assign class."}), 400


@app.route("/api/admin/unassign_class", methods=["POST"])
@login_required
@role_required("admin")
def api_admin_unassign_class():
    data = request.get_json(force=True)
    username = data.get("username", "").strip()
    class_id = data.get("classId", "").strip()

    if not username or not class_id:
        return jsonify({"success": False, "error": "Username and classId required."}), 400

    if storage.unassign_class_from_teacher(username, class_id):
        return jsonify({"success": True, "message": f"Class unassigned from {username}."})
    return jsonify({"success": False, "error": "Failed to unassign class."}), 400


# ─── API: Student Portal & Passcode marking ───────────────────────────────────
@app.route("/api/student/dashboard_data", methods=["GET"])
@login_required
@role_required("student")
def api_student_dashboard_data():
    student_id = session.get("user")
    student_name = session.get("name")
    
    profile = storage.load_profile(student_name)
    if not profile:
        return jsonify({"success": False, "error": "Profile not found."}), 404
        
    stats = storage.get_student_attendance_summary(student_name)
    
    # Get active sessions matching student class and division
    student_class = profile.get("class", "")
    student_div   = profile.get("div", "")
    matching_sessions = []
    
    with _session_lock:
        for cid, sess in _active_sessions.items():
            if sess.get("active"):
                sess_class = sess.get("class", "")
                sess_div   = sess.get("div", "")
                if sess_class == student_class and (not sess_div or sess_div == "__all__" or sess_div == student_div):
                    matching_sessions.append({
                        "classId": sess["classId"],
                        "subject": sess["subject"],
                        "class": sess.get("class", ""),
                        "div": sess.get("div", ""),
                        "section": f"{sess.get('class', '')}-{sess.get('div', '')}",
                        "teacher": sess["teacher"],
                        "startTime": sess["startTime"],
                    })
                    
    return jsonify({
        "success": True,
        "profile": profile,
        "stats": stats,
        "active_sessions": matching_sessions
    })


@app.route("/api/student/verify_passcode", methods=["POST"])
@login_required
@role_required("student")
def api_student_verify_passcode():
    data = request.get_json(force=True)
    class_id = data.get("classId", "").strip()
    passcode = data.get("passcode", "").strip()

    if not class_id or not passcode:
        return jsonify({"success": False, "error": "classId and passcode required."}), 400

    with _session_lock:
        sess = _active_sessions.get(class_id)
        if not sess or not sess.get("active"):
            return jsonify({"success": False, "error": "No active session for this class."}), 400
        
        expected_passcode = sess.get("passcode", "")
        if passcode != expected_passcode:
            return jsonify({"success": False, "error": "Incorrect passcode."}), 401
            
    # Generate unique temporary verification token
    import secrets
    token = secrets.token_hex(16)
    
    if "attendance_tokens" not in session:
        session["attendance_tokens"] = {}
        
    session["attendance_tokens"][class_id] = token
    session.modified = True
    
    return jsonify({"success": True, "token": token})


@app.route("/api/student/session_details", methods=["GET"])
@login_required
@role_required("student")
def api_student_session_details():
    class_id = request.args.get("class_id", "").strip()
    with _session_lock:
        sess = _active_sessions.get(class_id)
        if not sess or not sess.get("active"):
            return jsonify({"success": False, "error": "Session not active."}), 400
        return jsonify({
            "success": True,
            "session": {
                "classId": sess["classId"],
                "subject": sess["subject"],
                "class": sess.get("class", ""),
                "div": sess.get("div", ""),
                "section": f"{sess.get('class', '')}-{sess.get('div', '')}",
                "teacher": sess["teacher"]
            }
        })


@app.route("/api/student/mark_attendance", methods=["POST"])
@login_required
@role_required("student")
def api_student_mark_attendance():
    data = request.get_json(force=True)
    class_id = data.get("classId", "").strip()
    token = data.get("token", "").strip()
    image_b64 = data.get("image", "")

    if not class_id or not token or not image_b64:
        return jsonify({"success": False, "error": "Missing classId, token, or image."}), 400

    # Verify token matching
    saved_token = session.get("attendance_tokens", {}).get(class_id)
    if not saved_token or saved_token != token:
        return jsonify({"success": False, "error": "Unauthorized session token."}), 403

    with _session_lock:
        session_obj = _active_sessions.get(class_id)
        if not session_obj or not session_obj.get("active"):
            return jsonify({"success": False, "error": f"No active session for {class_id}."}), 400

    try:
        img_bgr = recognition.decode_image(image_b64)
        with _cache_lock:
            current_embeddings = dict(_embeddings_cache)
        result = recognition.recognize_face(img_bgr, current_embeddings)

        if not result["recognized"]:
            return jsonify({
                "success":       True,
                "recognized":    False,
                "face_detected": result["face_detected"],
                "marked":        False,
                "name":          None,
            })

        recognized_name = result["name"]
        logged_in_student_name = session.get("name")

        # Student can ONLY mark their own attendance
        if recognized_name != logged_in_student_name:
            return jsonify({
                "success": False,
                "error": "Face does not match the logged-in student."
            }), 403

        now = datetime.now()
        with _session_lock:
            start_str = session_obj.get("startTime", "00:00:00")
            late_min  = session_obj.get("lateAfterMinutes", 10)
            try:
                start_dt = datetime.strptime(f"{session_obj['date']} {start_str}", "%Y-%m-%d %H:%M:%S")
                is_late = (now - start_dt).total_seconds() > late_min * 60
            except Exception:
                is_late = False

            new_status = "late" if is_late else "present"
            already_marked = False

            for rec in session_obj["records"]:
                if rec["name"] == recognized_name:
                    if rec["status"] in ("present", "late"):
                        already_marked = True
                    else:
                        rec["status"]   = new_status
                        rec["markedAt"] = now.strftime("%H:%M:%S")
                    break
            else:
                profile = storage.load_profile(recognized_name)
                session_obj["records"].append({
                    "name":      recognized_name,
                    "studentId": profile.get("studentId", "") if profile else "",
                    "rollNo":    profile.get("rollNo", "") if profile else "",
                    "status":    new_status,
                    "markedAt":  now.strftime("%H:%M:%S"),
                })

            if not already_marked:
                storage.save_attendance_session(session_obj)

        # Remove token after successful mark to prevent reuse
        session["attendance_tokens"].pop(class_id, None)
        session.modified = True

        return jsonify({
            "success":       True,
            "recognized":    True,
            "face_detected": True,
            "marked":        not already_marked,
            "alreadyMarked": already_marked,
            "name":          recognized_name,
            "status":        new_status,
            "confidence":    result["confidence"],
        })

    except Exception as e:
        app.logger.error(f"Student attendance mark error: {e}", exc_info=True)
        return jsonify({"success": False, "error": str(e)}), 500


# ─── Entry Point ───────────────────────────────────────────────────────────────
if __name__ == "__main__":
    import sys
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    print("=" * 60)
    print("  [ATTEND] Smart Student Attendance System")
    print("  Starting Flask server on http://localhost:5000")
    print("  First run: downloads YuNet + SFace models (~38 MB)")
    print("=" * 60)
    storage.ensure_dirs()
    recognition.warm_up()
    app.run(host="0.0.0.0", port=5000, debug=False, threaded=True)
