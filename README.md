# 🎓 AttendSmart — Smart Student Attendance System

AttendSmart is a high-performance, fully **offline**, AI-powered **Student Attendance System** built with Python (Flask) and OpenCV's YuNet + SFace face recognition models. Teachers can mark class attendance instantly by starting a session and pointing a webcam at the classroom—faces are recognized automatically in real time.

**No cloud dependencies, no external database, no internet required.** All data processing, mathematical vector matching, and storage occur entirely locally.

---

## ✨ Features

| Feature | Description |
| :--- | :--- |
| **🔒 100% Offline & Private** | Fully local deployment. Student photos and facial templates never leave the host machine. |
| **🔑 Role-Based Access Control** | Dedicated portals and permission scopes for Admins, Teachers, and Students. |
| **⚙️ Admin Console** | Admin portal to manage teacher accounts, assign classes, monitor statistics, and enroll students. |
| **🧠 Local AI Face Pipeline** | Combined OpenCV YuNet (detection) and SFace (recognition) ONNX neural networks. |
| **🔢 Passcode Verification** | Teachers set a temporary passcode; students verify using their face scan + passcode to self-mark. |
| **📷 Real-time Marking** | Live webcam streaming with visual bounding boxes, auto-detecting and marking students present. |
| **🟡 Late Arrival Detection** | Customizable class-specific late thresholds (e.g., mark as "Late" if arriving after 10 minutes). |
| **✋ Teacher Controls** | Real-time roll checklist with manual checkbox status override (Present, Late, Absent). |
| **✏️ Edit Past Records** | Modify past session checklists through the Reports console. |
| **💾 Persistent & Resilient** | Starts-to-ends session states are auto-saved to disk immediately. Recoverable from crashes or server restarts. |
| **📋 Reports & Export** | Filter records by Date, Class, Student, and Status. Export filtered data directly to CSV. |
| **🎨 Academic Dark UI** | Modern glassmorphism layout, clean dark color scheme, responsive sidebar, and notification toasts. |

---

## ⚙️ Deep-Dive Architecture & Core Concepts (Hot Concepts)

AttendSmart operates on a set of core mathematical, architectural, and security concepts that make the system fast, secure, and resilient.

### 1. Dual-Model ONNX Face Pipeline
The face recognition engine uses two pre-trained neural networks running via OpenCV's `dnn` module:
*   **YuNet (Face Detection)**: A lightweight, fast, and highly accurate face detector designed for edge devices. It locates faces in a frame and extracts landmark coordinates (eyes, nose, mouth corners) even with partial occlusion, rotation, or lighting changes.
*   **SFace (Face Recognition)**: A state-of-the-art face recognition network. It takes the aligned face image from YuNet and computes a **128-dimensional floating-point embedding vector** that represents the unique features of the face.

### 2. Cosine Similarity Vector Matching
Instead of traditional database lookups, face recognition is performed using vector mathematics. When a student is captured:
1. SFace computes their face embedding vector ($A$).
2. The system calculates the **Cosine Similarity** between $A$ and all registered student embeddings ($B$) in memory:
   $$\text{Similarity} = \frac{A \cdot B}{\|A\| \|B\|}$$
3. The student with the highest similarity score above the `SIMILARITY_THRESHOLD` (default: `0.42`) is marked present. This threshold is balanced to minimize False Acceptances (marking the wrong student) while maintaining a low False Rejection rate.

### 3. Laplacian Variance Blur Filtering
To prevent low-quality face enrollments (which degrade recognition accuracy), the system runs a camera quality check during student registration:
*   It computes the Laplacian operator on the captured image and calculates the variance of the result.
*   If the variance is below the `BLUR_THRESHOLD` (default: `75.0`), the frame is rejected as out-of-focus or motion-blurred, instructing the admin to capture a clearer photo.

### 4. Real-time Persistence & Crash Recovery
To guarantee data integrity, AttendSmart utilizes a hybrid memory-disk persistence strategy:
*   **Startup Deserializer**: On server startup, the backend automatically scans the local directory for active session files and deserializes them into the in-memory active sessions dictionary (`_active_sessions`).
*   **Immediate Saves**: Whenever a state change occurs (session started, student auto-marked by camera, teacher manually overrides roll status, student self-marks via portal), the session dictionary is instantly serialized to disk as a JSON file.
*   **Resiliency**: If the server crashes, power cuts, or is restarted mid-class, the active session is fully recovered upon restart, and teachers can continue marking attendance without losing any data.

### 5. Multi-Factor Student Self-Marking Security
Students can mark their own attendance via the student dashboard using a multi-factor authentication flow:
1. **Passcode Challenge**: The student must enter the session passcode set by the teacher.
2. **Session Verification Token**: Upon verification, the server generates a cryptographically secure, single-use token (`secrets.token_hex(16)`) cached in the student's session.
3. **Face Scan**: The student scans their face on their personal device. The backend verifies the face against the logged-in student's profile AND invalidates the temporary token to prevent replay attacks or spoofing.

### 6. Thread-Safe Global State Management
Because Flask handles requests concurrently using multiple threads, global states (embeddings cache, active sessions list) are wrapped in Python's reentrant thread locks (`threading.Lock`):
*   `_session_lock` prevents race conditions when multiple students self-mark or teachers manually edit roll sheets simultaneously.
*   `_cache_lock` ensures that the face matching algorithm reads a consistent list of student embeddings while new students are being registered.

---

## 🛠️ Technology Stack

*   **Backend Framework**: Python, Flask (lightweight, modular web server).
*   **Computer Vision**: OpenCV (Open Source Computer Vision Library) with DNN module.
*   **Data Structures & Math**: NumPy (fast vector mathematics and array operations).
*   **Security & Hashing**: Werkzeug Security (scrypt password hashing) and Secrets token generation.
*   **Frontend**: Vanilla HTML5, CSS3 (Academic Dark glassmorphism theme, CSS custom properties, grid layouts), and Vanilla JavaScript (AJAX, camera stream rendering, canvas drawing).
*   **Export Engine**: Python `csv` module for reports export.

---

## 📁 Project Structure

```
face/
├── app.py                    # Flask server, authentication decorators, and all API endpoints
├── requirements.txt          # Python dependencies list
├── README.md                 # System manual and technical documentation
├── .gitignore                # File to exclude virtual envs, model weights, and student data
│
├── core/
│   ├── __init__.py           # Package initializer
│   ├── recognition.py        # YuNet detector + SFace recognizer, image decoding, and vector matching
│   └── storage.py            # Local File System Engine: loads/saves profiles, embeddings, and attendance
│
├── templates/
│   ├── _sidebar.html         # Common sidebar navigation (dynamically highlights paths based on user role)
│   ├── _topbar.html          # Global topbar (displays notifications, role name, and logout button)
│   ├── index.html            # Main Dashboard (redirects dynamically to student/teacher/admin views)
│   ├── login.html            # Universal login portal for all three roles
│   ├── admin.html            # Admin dashboard to register teachers, view stats, and assign classes
│   ├── register.html         # Admin student enrollment page with blur check and webcam capture
│   ├── students.html         # Student directory grid view with search, filter, and edit controls
│   ├── attend.html           # Teacher live webcam face scanning and roll checklist panel
│   ├── student_dashboard.html # Student personal dashboard to view stats and join active sessions
│   ├── student_attend.html   # Student webcam face verification page for self-marking
│   ├── reports.html          # Teacher reports database with date/class filters and CSV download
│   └── users.html            # Admin user directory to manage teachers and view class allocations
│
├── static/
│   ├── css/
│   │   └── style.css         # Academic Dark theme design system and layout components
│   └── js/
│       ├── dashboard.js      # Dashboard dynamic stats and live today's classes grid
│       ├── attend.js         # Real-time webcam face-scan marker and roll updater
│       ├── register.js       # Registration webcam photo capture and countdown timer
│       ├── students.js       # Searchable student database grid and edit/delete profiles modals
│       └── reports.js        # Filterable, paginated reports and CSV export scripts
│
└── data/                     # Auto-created at runtime (ignored in Git)
    ├── people/               # Student folders containing profile.json and profile.jpg
    ├── embeddings/           # Face mathematical templates stored as NumPy (.npy) arrays
    ├── attendance/           # Attendance record files stored as YYYY-MM-DD/<class_id>.json
    ├── classes.json          # Subject-Class configurations registry
    ├── teachers.json         # Teacher credentials, roles, and assigned classes (local database)
    └── models/               # Auto-downloaded YuNet and SFace ONNX models
```

---

## 🚀 Installation & Setup

### Prerequisites
*   **Python 3.10 to 3.13** installed on your system.
*   **pip** (Python package manager).
*   A functional **webcam** connected to your host device.

### Step 1 — Clone/Navigate to Project folder
```powershell
cd d:\face
```

### Step 2 — Create virtual environment
```powershell
python -m venv .venv
```

### Step 3 — Install dependencies
```powershell
.venv\Scripts\pip.exe install flask flask-cors opencv-python numpy Pillow scipy requests openpyxl
```

### Step 4 — Run the App
```powershell
.venv\Scripts\python.exe app.py
```

*Note: On first startup, the app will download `face_detection_yunet_2023mar.onnx` and `face_recognition_sface_2021dec.onnx` (~38 MB total) automatically into the `data/models/` folder. All subsequent startups will be completely offline.*

### Step 5 — Access the system
Open your browser and navigate to:
```
http://localhost:5000
```

---

## 🔐 Default Administrator Login

To begin configuration, log in using the pre-seeded administrator credentials:
*   **URL**: `http://localhost:5000/login`
*   **Role**: Select **Admin**
*   **Username**: `admin`
*   **Password**: `admin`

---

## 📖 Complete User Flow Guide

### 1. System Setup (Admin)
1. Log in as **Admin** and navigate to **Manage Users** in the sidebar.
2. Create **Teacher accounts** and assign classes/subjects to them.
3. Go to **Enroll Student** and fill out the enrollment form:
   * Start the camera.
   * Have the student face the camera and click **Capture**.
   * Fill in their Name, Student ID, Class, Division, Roll Number, and Department.
   * Click **Enroll Student** to save their profile, face image, and embedding vector.

### 2. Conducting a Session (Teacher)
1. Log in as **Teacher** and navigate to the **Take Attendance** page.
2. Click **Start Session** and select the subject/class. Specify a session passcode (e.g., `4591`) and late arrival threshold.
3. Share the passcode with the students in the class.
4. Keep the teacher's webcam active, or instruct students to mark themselves present.
5. Watch the attendance roll update in real-time as student faces are detected.
6. Manually toggle attendance status (Present, Late, Absent) if a student's face was not detected or they left early.
7. Click **End Session** to finalize the session.

### 3. Self-Marking Attendance (Student)
1. Log in as **Student** (usernames are their student IDs, and default passwords are set upon registration).
2. Look at the **Active Attendance Sessions** grid.
3. Click **Mark Attendance** on the corresponding active session.
4. Enter the session passcode provided by the teacher.
5. Align your face with the camera guidelines on the screen. The page will verify your face and mark you present/late instantly.

---

## 🔌 API Reference

| Method | Endpoint | Auth | Description |
| :--- | :--- | :--- | :--- |
| `POST` | `/api/login` | None | Verify credentials, store details in Flask session, return dashboard URL. |
| `POST` | `/api/register` | Admin | Register new student, process image, generate 128D embedding, save to disk. |
| `GET` | `/api/students` | Admin | List all registered student profiles with their aggregate attendance percentage. |
| `PUT` | `/api/students/<name>` | Admin | Update student metadata fields (class, div, roll no). |
| `DELETE` | `/api/students/<name>`| Admin | Delete student folder, photo, and embedding vector. |
| `POST` | `/api/classes` | Admin | Save a new class/subject configuration. |
| `POST` | `/api/attendance/start`| Teacher | Start a live session, verify no conflicts, compile class roll, save to memory & disk. |
| `GET` | `/api/attendance/session`| Teacher | Retrieve current active session details, active passcode, and full live roll. |
| `POST` | `/api/attendance/mark` | Teacher | Recognize face in frame, check class matching, mark present/late, update logs. |
| `POST` | `/api/attendance/manual`| Teacher | Manually toggle a student's status on the live roll sheet, write changes to disk. |
| `POST` | `/api/attendance/end` | Teacher | Finalize session, set active = false, record end time, write session log. |
| `GET` | `/api/attendance/today` | Teacher | Fetch summary statistics of all sessions conducted today. |
| `GET` | `/api/student/dashboard_data` | Student | Fetch student profile, attendance summary statistics, and active class sessions. |
| `POST` | `/api/student/verify_passcode`| Student | Match student class passcode, return one-time cryptographically secure token. |
| `POST` | `/api/student/mark_attendance`| Student | Validate single-use token, verify student face, mark attendance status. |

---

## 📊 Tuning & Configuration

You can open `core/recognition.py` to customize neural network settings:

*   `SIMILARITY_THRESHOLD` (default `0.42`): Lower value = less strict matching (increases risk of false match); Higher value = stricter matching (increases risk of rejecting a valid face).
*   `BLUR_THRESHOLD` (default `75.0`): Increase to enforce capture of highly sharp images during registration; decrease if registration fails too often under low-light/older webcams.

---

## 📜 License

This project is licensed under the MIT License. Feel free to modify, distribute, and integrate it into your projects.
