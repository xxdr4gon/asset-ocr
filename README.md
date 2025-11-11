# OCR/QR GLPI Gateway (Dockerized)

This stack provides:
- Nginx serving a web UI over HTTPS on port 8443
- FastAPI backend for OCR (Tesseract), QR decoding, and GLPI REST API operations

Components:
- `nginx` (serves `web/`, proxies `/api/*` to backend)
- `backend` (FastAPI + pytesseract + pyzbar)

Prerequisites:
- Docker and Docker Compose

Configuration:
Create a `.env` file in the project root with:

```
GLPI_URL=https://glpi.example.com/apirest.php
GLPI_APP_TOKEN=your_glpi_app_token
GLPI_USER_TOKEN=your_glpi_user_token
NGINX_SERVER_NAME=localhost
```

Run:
```
docker compose build
docker compose up -d
```

Access:
- https://localhost:8443
- Self-signed certificate is generated at container start (browser will warn)

API (proxied under `/api`):
- POST `/api/add_entry` (multipart form):
  - `spec_image`: image/* (required)
  - `qr_image`: image/* (optional)
  - `item_type`: default `Computer`
- POST `/api/scan_qr` (multipart form):
  - `file`: image/* (required)
- POST `/api/change_location` (JSON):
  - `{ "item_id": 123 | null, "qr_value": "string" | null, "location_id": 5 }`
- POST `/api/change_user` (JSON):
  - `{ "item_id": 123 | null, "qr_value": "string" | null, "user_id": 42 }`
- POST `/api/check_entry` (JSON):
  - `{ "item_id": 123 | null, "qr_value": "string" | null }`

Notes:
- OCR heuristics in `backend/app/main.py` parse common labels like Model, Serial (S/N), P/N.
- Item type defaults to `Computer` for GLPI but can be changed if needed.

Publishing to GitHub

1) Ensure `.env` exists locally but is not committed (it's ignored via `.gitignore`).
2) Initialize git, add the remote, and push:
```
git init
git remote add origin https://github.com/xxdr4gon/asset-ocr.git
git add .
git commit -m "Initial OCR/QR GLPI gateway with camera flows"
git branch -M main
git push -u origin main
```


