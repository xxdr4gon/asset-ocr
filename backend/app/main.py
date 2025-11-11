from fastapi import FastAPI, UploadFile, File, Form, HTTPException
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from typing import Optional, Dict, Any
import os
import io
import re
import requests
from PIL import Image
import pytesseract
from pyzbar.pyzbar import decode as qr_decode


class GLPIConfig(BaseModel):
    url: str
    app_token: str
    user_token: str


def get_glpi_config() -> GLPIConfig:
    url = os.getenv("GLPI_URL", "").rstrip("/")
    app_token = os.getenv("GLPI_APP_TOKEN", "")
    user_token = os.getenv("GLPI_USER_TOKEN", "")
    if not url or not app_token or not user_token:
        raise RuntimeError("GLPI configuration missing. Please set GLPI_URL, GLPI_APP_TOKEN, GLPI_USER_TOKEN.")
    return GLPIConfig(url=url, app_token=app_token, user_token=user_token)


def glpi_headers(cfg: GLPIConfig, session_token: Optional[str] = None) -> Dict[str, str]:
    headers: Dict[str, str] = {"App-Token": cfg.app_token}
    if session_token:
        headers["Session-Token"] = session_token
    return headers


def glpi_init_session(cfg: GLPIConfig) -> str:
    # GLPI expects POST /initSession with App-Token + Authorization: user_token ...
    headers = {"App-Token": cfg.app_token, "Authorization": f"user_token {cfg.user_token}"}
    resp = requests.post(f"{cfg.url}/initSession", headers=headers)
    if resp.status_code != 200:
        raise HTTPException(status_code=502, detail=f"GLPI initSession failed: {resp.text}")
    data = resp.json()
    return data.get("session_token", "")


def glpi_kill_session(cfg: GLPIConfig, session_token: str) -> None:
    try:
        requests.get(f"{cfg.url}/killSession", headers=glpi_headers(cfg, session_token=session_token), timeout=5)
    except Exception:
        pass


def parse_spec_text(text: str) -> Dict[str, Optional[str]]:
    # Normalize
    lines = [re.sub(r"\s+", " ", l).strip() for l in text.splitlines()]
    joined = "\n".join(lines)

    # Lowercase blob for classification
    joined_lower = joined.lower()

    patterns = {
        "serial": [
            r"\bS\/?N[:\s\-]*([A-Za-z0-9\-]{5,})\b",
            r"\bSerial(?: Number)?[:\s\-]*([A-Za-z0-9\-]{5,})\b",
        ],
        "model": [
            r"\bModel(?: No\.?)?[:\s\-]*([A-Za-z0-9\-\s]{2,})\b",
            r"\bProduct(?: Name)?[:\s\-]*([A-Za-z0-9\-\s]{2,})\b",
        ],
        "manufacturer": [
            r"\bBrand[:\s\-]*([A-Za-z0-9\-\s]{2,})\b",
            r"\bManufacturer[:\s\-]*([A-Za-z0-9\-\s]{2,})\b",
        ],
        "part_number": [
            r"\bP\/?N[:\s\-]*([A-Za-z0-9\-]{3,})\b",
            r"\bPart(?: Number)?[:\s\-]*([A-Za-z0-9\-]{3,})\b",
        ],
    }

    def find_first(pats):
        for p in pats:
            m = re.search(p, joined, flags=re.IGNORECASE)
            if m:
                return m.group(1).strip()
        return None

    result = {
        "serial": find_first(patterns["serial"]),
        "model": find_first(patterns["model"]),
        "manufacturer": find_first(patterns["manufacturer"]),
        "part_number": find_first(patterns["part_number"]),
    }
    result["raw_text"] = joined  # keep original normalized text for classification
    result["raw_text_lower"] = joined_lower
    return result


def classify_item(parsed: Dict[str, Optional[str]]) -> Dict[str, str]:
    """
    Heuristic classification:
    - Choose GLPI endpoint (item_type) among: Computer, NetworkEquipment, Printer, Peripheral
    - Provide category hint for comment: Laptop, Desktop, Server, Switch, Router, Printer, UPS, Monitor
    """
    text = (parsed.get("raw_text_lower") or "")

    def has(*phrases: str) -> bool:
        return any(p in text for p in phrases)

    # Vendor/product-line heuristics
    if has("poweredge", "proliant", "thinksystem", "poweredge r", "poweredge t"):
        return {"item_type": "Computer", "category": "Server"}
    if has("thinkpad", "latitude", "elitebook", "probook", "macbook", "xps", "precision mobile"):
        return {"item_type": "Computer", "category": "Laptop"}
    if has("optiplex", "thinkcentre", "vostro", "elite desk", "pro desk", "imac", "mac mini"):
        return {"item_type": "Computer", "category": "Desktop"}
    if has("catalyst", "nexus", "aruba", "unifi", "edge switch", "switch", "router", "firewall", "fortigate", "juniper"):
        return {"item_type": "NetworkEquipment", "category": "Network"}
    if has("laserjet", "deskjet", "image runner", "bizhub", "printer", "mfp"):
        return {"item_type": "Printer", "category": "Printer"}
    if has("ups", "smart-ups", "back-ups", "surge", "pdu"):
        return {"item_type": "Peripheral", "category": "UPS"}
    if has("monitor", "lcd", "led display", "ultrasharp"):
        return {"item_type": "Peripheral", "category": "Monitor"}

    # Fallback to computer
    return {"item_type": "Computer", "category": "Unknown"}


def image_to_text(img: Image.Image) -> str:
    # Simple preprocessing: convert to grayscale; Tesseract will handle DPI defaults
    gray = img.convert("L")
    text = pytesseract.image_to_string(gray)
    return text


def decode_qr_from_image(img: Image.Image) -> Optional[str]:
    # Try raw decode
    results = qr_decode(img)
    if results:
        return results[0].data.decode("utf-8", errors="ignore")
    # Try higher resolution for small QRs
    w, h = img.size
    if max(w, h) < 800:
        scale = max(2, int(800 / max(w, h)))
        img = img.resize((w * scale, h * scale))
        results = qr_decode(img)
        if results:
            return results[0].data.decode("utf-8", errors="ignore")
    return None


class UpdateLocationRequest(BaseModel):
    item_id: Optional[int] = None
    qr_value: Optional[str] = None
    location_id: int


class UpdateUserRequest(BaseModel):
    item_id: Optional[int] = None
    qr_value: Optional[str] = None
    user_id: int


class CheckEntryRequest(BaseModel):
    item_id: Optional[int] = None
    qr_value: Optional[str] = None


app = FastAPI(title="OCR/QR GLPI Gateway", version="0.1.0")


@app.get("/api/health")
def health() -> Dict[str, Any]:
    return {"status": "ok"}

@app.get("/api/config")
def public_config() -> Dict[str, Any]:
    glpi_url = os.getenv("GLPI_URL", "").strip()
    app_token = os.getenv("GLPI_APP_TOKEN", "").strip()
    user_token = os.getenv("GLPI_USER_TOKEN", "").strip()
    glpi_enabled = bool(glpi_url and app_token and user_token)
    return {"glpi_enabled": glpi_enabled}


@app.post("/api/scan_qr")
async def scan_qr(file: UploadFile = File(...)) -> Dict[str, Optional[str]]:
    content = await file.read()
    try:
        img = Image.open(io.BytesIO(content))
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Cannot open image: {e}")
    value = decode_qr_from_image(img)
    return {"qr_value": value}


@app.post("/api/add_entry")
async def add_entry(
    spec_image: UploadFile = File(...),
    qr_image: Optional[UploadFile] = File(None),
    item_type: str = Form("auto"),
) -> JSONResponse:
    cfg = get_glpi_config()
    session = glpi_init_session(cfg)
    try:
        # OCR parse
        spec_bytes = await spec_image.read()
        try:
            spec_img = Image.open(io.BytesIO(spec_bytes))
        except Exception as e:
            raise HTTPException(status_code=400, detail=f"Cannot open spec image: {e}")
        text = image_to_text(spec_img)
        parsed = parse_spec_text(text)

        classification = classify_item(parsed) if item_type == "auto" else {"item_type": item_type, "category": "Unspecified"}
        target_item_type = classification["item_type"]

        qr_value = None
        if qr_image is not None:
            qbytes = await qr_image.read()
            try:
                qimg = Image.open(io.BytesIO(qbytes))
                qr_value = decode_qr_from_image(qimg)
            except Exception:
                qr_value = None

        payload = {
            "name": parsed.get("model") or parsed.get("serial") or "New Asset",
            "serial": parsed.get("serial"),
            "otherserial": parsed.get("part_number"),
            "comment": (
                f"Manufacturer: {parsed.get('manufacturer') or ''}\n"
                f"Category: {classification.get('category')}\n"
                f"QR: {qr_value or ''}"
            ),
        }

        # Create item in GLPI
        resp = requests.post(
            f"{cfg.url}/{target_item_type}",
            headers={**glpi_headers(cfg, session_token=session), "Content-Type": "application/json"},
            json={"input": payload},
            timeout=30,
        )
        if resp.status_code not in (200, 201):
            raise HTTPException(status_code=502, detail=f"GLPI create failed: {resp.text}")
        return JSONResponse(
            content={
                "created": True,
                "payload": payload,
                "classification": classification,
                "target_item_type": target_item_type,
                "glpi": resp.json(),
            }
        )
    finally:
        glpi_kill_session(cfg, session)


def resolve_item_id(cfg: GLPIConfig, session: str, qr_value: Optional[str], fallback_id: Optional[int]) -> int:
    if fallback_id:
        return fallback_id
    if not qr_value:
        raise HTTPException(status_code=400, detail="Either item_id or qr_value is required.")
    # Example search: try generic search API on Computers for a field containing QR string
    params = {
        "criteria[0][field]": "1",  # name
        "criteria[0][searchtype]": "contains",
        "criteria[0][value]": qr_value,
        "forcedisplay[0]": "2",  # id
    }
    r = requests.get(f"{cfg.url}/search/Computer", headers=glpi_headers(cfg, session), params=params, timeout=20)
    if r.status_code != 200:
        raise HTTPException(status_code=502, detail=f"GLPI search failed: {r.text}")
    data = r.json()
    # Pick first match
    try:
        rows = data["data"]
        if not rows:
            raise HTTPException(status_code=404, detail="No matching item found for QR.")
        first = rows[0]
        # Depending on GLPI version, id might be in '2' or 'id'
        item_id = int(first.get("2") or first.get("id"))
        return item_id
    except Exception:
        raise HTTPException(status_code=502, detail="Unexpected GLPI search response format.")


@app.post("/api/change_location")
def change_location(req: UpdateLocationRequest):
    cfg = get_glpi_config()
    session = glpi_init_session(cfg)
    try:
        item_id = resolve_item_id(cfg, session, req.qr_value, req.item_id)
        payload = {"locations_id": req.location_id}
        r = requests.put(
            f"{cfg.url}/Computer/{item_id}",
            headers={**glpi_headers(cfg, session), "Content-Type": "application/json"},
            json={"input": payload},
            timeout=20,
        )
        if r.status_code not in (200, 201):
            raise HTTPException(status_code=502, detail=f"GLPI update location failed: {r.text}")
        return {"updated": True, "item_id": item_id, "glpi": r.json()}
    finally:
        glpi_kill_session(cfg, session)


@app.post("/api/change_user")
def change_user(req: UpdateUserRequest):
    cfg = get_glpi_config()
    session = glpi_init_session(cfg)
    try:
        item_id = resolve_item_id(cfg, session, req.qr_value, req.item_id)
        payload = {"users_id": req.user_id}
        r = requests.put(
            f"{cfg.url}/Computer/{item_id}",
            headers={**glpi_headers(cfg, session), "Content-Type": "application/json"},
            json={"input": payload},
            timeout=20,
        )
        if r.status_code not in (200, 201):
            raise HTTPException(status_code=502, detail=f"GLPI update user failed: {r.text}")
        return {"updated": True, "item_id": item_id, "glpi": r.json()}
    finally:
        glpi_kill_session(cfg, session)


@app.post("/api/check_entry")
def check_entry(req: CheckEntryRequest):
    cfg = get_glpi_config()
    session = glpi_init_session(cfg)
    try:
        item_id = resolve_item_id(cfg, session, req.qr_value, req.item_id)
        r = requests.get(f"{cfg.url}/Computer/{item_id}", headers=glpi_headers(cfg, session), timeout=20)
        if r.status_code != 200:
            raise HTTPException(status_code=502, detail=f"GLPI get failed: {r.text}")
        return {"exists": True, "item_id": item_id, "glpi": r.json()}
    finally:
        glpi_kill_session(cfg, session)


