"""
recognition.py — Face recognition engine using OpenCV's YuNet + SFace ONNX models.

WHY THIS APPROACH:
  - Python 3.13 compatible (no TensorFlow, no Torch, no C compilation)
  - YuNet: ultra-fast face detector (~2MB ONNX model)
  - SFace: state-of-the-art face recognizer (~36MB ONNX model)
  - Both models integrate directly with cv2.FaceDetectorYN / cv2.FaceRecognizerSF
  - Models are downloaded once from OpenCV's official model zoo, then fully offline

FIRST RUN: Downloads ~38 MB of model weights from GitHub raw URLs.
SUBSEQUENT RUNS: Fully offline from local model cache (data/models/).
"""

import cv2
import numpy as np
import requests
import base64
from io import BytesIO
from pathlib import Path
from PIL import Image

# ─── Paths ─────────────────────────────────────────────────────────────────────
BASE_DIR   = Path(__file__).resolve().parent.parent
MODELS_DIR = BASE_DIR / "data" / "models"

# YuNet face detector (≈ 2 MB)
YUNET_FILENAME = "face_detection_yunet_2023mar.onnx"
YUNET_URL      = (
    "https://github.com/opencv/opencv_zoo/raw/main/"
    "models/face_detection_yunet/face_detection_yunet_2023mar.onnx"
)
YUNET_PATH = MODELS_DIR / YUNET_FILENAME

# SFace face recognizer (≈ 36 MB)
SFACE_FILENAME = "face_recognition_sface_2021dec.onnx"
SFACE_URL      = (
    "https://github.com/opencv/opencv_zoo/raw/main/"
    "models/face_recognition_sface/face_recognition_sface_2021dec.onnx"
)
SFACE_PATH = MODELS_DIR / SFACE_FILENAME

# ─── Recognition Configuration ────────────────────────────────────────────────
# SFace cosine similarity threshold.
# Higher value = stricter matching (fewer false positives).
# Recommended range: 0.38 – 0.55
SIMILARITY_THRESHOLD = 0.42

BLUR_THRESHOLD = 75.0   # Laplacian variance; below this = too blurry

LIVENESS_THRESHOLD = 3.0
LIVENESS_REQUIRED_FRAMES = 3

# ─── Lazy-loaded model instances ──────────────────────────────────────────────
_detector   = None
_recognizer = None


# ─── Model Download ───────────────────────────────────────────────────────────
def _download_model(url: str, path: Path) -> None:
    """Download a model file if it is not already cached."""
    if path.exists():
        return
    MODELS_DIR.mkdir(parents=True, exist_ok=True)
    print(f"[FaceID] Downloading model: {path.name} … (one-time only)", flush=True)
    try:
        response = requests.get(url, stream=True, timeout=180,
                                headers={"User-Agent": "FaceID/1.0"})
        response.raise_for_status()

        tmp = path.with_suffix(".tmp")
        with open(tmp, "wb") as f:
            for chunk in response.iter_content(chunk_size=32_768):
                if chunk:
                    f.write(chunk)
        tmp.rename(path)
        size_mb = path.stat().st_size / 1_048_576
        print(f"[FaceID] Model saved: {path.name} ({size_mb:.1f} MB)", flush=True)
    except Exception as exc:
        tmp = path.with_suffix(".tmp")
        if tmp.exists():
            tmp.unlink()
        raise RuntimeError(f"Failed to download {path.name}: {exc}") from exc


def _get_detector() -> cv2.FaceDetectorYN:
    """Return (lazily initialised) YuNet face detector."""
    global _detector
    if _detector is None:
        _download_model(YUNET_URL, YUNET_PATH)
        _detector = cv2.FaceDetectorYN.create(
            str(YUNET_PATH),
            "",
            (320, 320),
            score_threshold=0.70,
            nms_threshold=0.30,
            top_k=5_000,
        )
    return _detector


def _get_recognizer() -> cv2.FaceRecognizerSF:
    """Return (lazily initialised) SFace face recognizer."""
    global _recognizer
    if _recognizer is None:
        _download_model(SFACE_URL, SFACE_PATH)
        _recognizer = cv2.FaceRecognizerSF.create(str(SFACE_PATH), "")
    return _recognizer


def warm_up() -> None:
    """Pre-load models into memory (call at startup for faster first recognition)."""
    print("[FaceID] Warming up face models…", flush=True)
    _get_detector()
    _get_recognizer()
    print("[FaceID] Models ready.", flush=True)


# ─── Image Utilities ───────────────────────────────────────────────────────────
def decode_image(image_data) -> np.ndarray:
    """
    Decode an image from a base64 string or raw bytes to a BGR numpy array.
    Accepts data-URI strings (data:image/...;base64,...) or plain base64.
    """
    if isinstance(image_data, str):
        if "," in image_data:
            image_data = image_data.split(",", 1)[1]
        image_bytes = base64.b64decode(image_data)
    else:
        image_bytes = image_data

    pil_img = Image.open(BytesIO(image_bytes)).convert("RGB")
    return cv2.cvtColor(np.array(pil_img), cv2.COLOR_RGB2BGR)


def encode_image_to_bytes(img_bgr: np.ndarray, quality: int = 90) -> bytes:
    """Encode a BGR numpy array to JPEG bytes."""
    ok, buf = cv2.imencode(".jpg", img_bgr, [cv2.IMWRITE_JPEG_QUALITY, quality])
    if not ok:
        raise ValueError("Failed to encode image to JPEG.")
    return buf.tobytes()


def is_blurry(img_bgr: np.ndarray) -> bool:
    """Return True if image Laplacian variance is below the blur threshold."""
    gray = cv2.cvtColor(img_bgr, cv2.COLOR_BGR2GRAY)
    return float(cv2.Laplacian(gray, cv2.CV_64F).var()) < BLUR_THRESHOLD


# ─── Internal: Face Detection ──────────────────────────────────────────────────
def _detect_faces(img_bgr: np.ndarray) -> np.ndarray | None:
    """
    Run YuNet on an image and return the raw detections array.

    Each row: [x, y, w, h, re_x, re_y, le_x, le_y, no_x, no_y,
               rmo_x, rmo_y, lmo_x, lmo_y, score]
    Returns None if no faces found.
    """
    detector = _get_detector()
    h, w = img_bgr.shape[:2]
    detector.setInputSize((w, h))
    _, faces = detector.detect(img_bgr)
    return faces   # None or ndarray shape (N, 15)


# ─── Face Validation ───────────────────────────────────────────────────────────
def validate_face(img_bgr: np.ndarray) -> dict:
    """
    Validate that the image is suitable for registration:
      1. Not blurry.
      2. Contains exactly one face.

    Returns {"valid": True} on success, or {"valid": False, "error": "…"}.
    """
    if is_blurry(img_bgr):
        return {
            "valid": False,
            "error": (
                "Image is too blurry. Please use better lighting "
                "or hold the camera steady."
            ),
        }

    faces = _detect_faces(img_bgr)

    if faces is None or len(faces) == 0:
        return {
            "valid": False,
            "error": "No face detected. Please ensure your face is clearly visible.",
        }

    if len(faces) > 1:
        return {
            "valid": False,
            "error": (
                f"Multiple faces detected ({len(faces)}). "
                "Please register with only one person in frame."
            ),
        }

    return {"valid": True}


# ─── Embedding Extraction ──────────────────────────────────────────────────────
def get_embedding(img_bgr: np.ndarray) -> np.ndarray:
    """
    Extract a face embedding vector from img_bgr using SFace.

    Returns an L2-normalised float32 numpy array.
    Raises ValueError if no face is detected.
    """
    faces = _detect_faces(img_bgr)
    if faces is None or len(faces) == 0:
        raise ValueError("No face detected in the provided image.")

    recognizer = _get_recognizer()

    # Pick the highest-confidence detection (first row after YuNet NMS)
    best_face = faces[0]

    aligned_face = recognizer.alignCrop(img_bgr, best_face)
    raw_feature  = recognizer.feature(aligned_face)     # shape (1, 128)

    flat = raw_feature.flatten().astype(np.float32)
    norm = np.linalg.norm(flat)
    if norm > 0:
        flat /= norm
    return flat


# ─── Cosine Similarity ─────────────────────────────────────────────────────────
def cosine_similarity(emb1: np.ndarray, emb2: np.ndarray) -> float:
    """
    Dot product of two L2-normalised vectors equals cosine similarity.
    Result is in [-1, 1]; higher is more similar.
    """
    return float(np.dot(emb1.flatten(), emb2.flatten()))


# ─── Live Recognition ──────────────────────────────────────────────────────────
def recognize_face(img_bgr: np.ndarray, all_embeddings: dict) -> dict:
    """
    Compare the face in img_bgr against every stored embedding.

    Args:
        img_bgr:        Incoming webcam frame (BGR numpy array).
        all_embeddings: {name: embedding_array} loaded from storage.

    Returns:
        {
          "recognized":    bool,
          "name":          str | None,
          "confidence":    float,   # percentage 0-100
          "face_detected": bool,
        }
    """
    if not all_embeddings:
        return {"recognized": False, "name": None, "confidence": 0.0, "face_detected": False}

    # Step 1: detect face in the live frame
    faces = _detect_faces(img_bgr)
    if faces is None or len(faces) == 0:
        return {"recognized": False, "name": None, "confidence": 0.0, "face_detected": False}

    # Step 2: extract embedding for the most prominent face
    recognizer = _get_recognizer()
    try:
        aligned = recognizer.alignCrop(img_bgr, faces[0])
        raw     = recognizer.feature(aligned).flatten().astype(np.float32)
        norm    = np.linalg.norm(raw)
        live_emb = raw / norm if norm > 0 else raw
    except Exception:
        return {"recognized": False, "name": None, "confidence": 0.0, "face_detected": True}

    # Step 3: compare against all stored embeddings
    best_name  = None
    best_score = -1.0

    for name, stored_emb in all_embeddings.items():
        score = cosine_similarity(live_emb, stored_emb)
        if score > best_score:
            best_score = score
            best_name  = name

    confidence = round(min(max(best_score, 0.0), 1.0) * 100, 1)

    if best_score >= SIMILARITY_THRESHOLD:
        return {
            "recognized":    True,
            "name":          best_name,
            "confidence":    confidence,
            "face_detected": True,
            "aligned_face":  aligned,
        }

    return {
        "recognized":    False,
        "name":          None,
        "confidence":    confidence,
        "face_detected": True,
        "aligned_face":  aligned if 'aligned' in locals() else None,
    }


def check_duplicate_face(new_emb: np.ndarray, all_embeddings: dict) -> str | None:
    """
    Return the name of an existing person if new_emb is too similar
    to any stored embedding (potential duplicate registration). Else None.
    """
    for name, stored_emb in all_embeddings.items():
        if cosine_similarity(new_emb, stored_emb) >= SIMILARITY_THRESHOLD:
            return name
    return None
