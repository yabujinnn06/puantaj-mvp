# Puantaj MVP

Bu repo, tek backend altında iki frontend SPA barındırır:

- `web-admin` -> `/admin-panel/*`
- `web-employee` -> `/employee/*`

Build çıktıları backend tarafından şu klasörlerden servis edilir:

- `app/static/admin`
- `app/static/employee`

## Gereksinimler

- Python 3.12
- Node.js + npm
- PostgreSQL

## Backend Kurulum ve Çalıştırma

```powershell
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
alembic upgrade head
uvicorn app.main:app --reload --port 8000
```

## Frontend Build (Tek Komut)

### Windows PowerShell

```powershell
.\scripts\build_all.ps1
```

İstersen sürümü elle verebilirsin:

```powershell
.\scripts\build_all.ps1 -BuildVersion 20260207-2215
```

### Linux/macOS

```bash
bash scripts/build_all.sh
```

İstersen sürümü elle verebilirsin:

```bash
bash scripts/build_all.sh 20260207-2215
```

## Not: PowerShell ve `&&`

Bazı PowerShell sürümlerinde `&&` beklenen şekilde çalışmaz.  
Bu durumda komutları ayrı satırda çalıştır veya `;` kullan:

```powershell
cd web-admin; npm run dev
```

## UI Build Sürümü Doğrulama

- Admin ve employee ekranlarının altında `Build: ...` görünür.
- Backend health endpoint’i aynı build sürümünü döner:

```bash
GET /health
```

Örnek çıktı:

```json
{
  "status": "ok",
  "ui_build_version": "20260207-2215"
}
```

## Backend Server Scripts (Windows PowerShell)

Bu komutlarla backend'i tek satirda ac/kapat/yeniden baslat yapabilirsin:

```powershell
.\scripts\status_server.ps1
.\scripts\start_server.ps1
.\scripts\stop_server.ps1
.\scripts\restart_server.ps1
```

Tek script ile de kullanabilirsin:

```powershell
.\scripts\server.ps1 status
.\scripts\server.ps1 start
.\scripts\server.ps1 stop
.\scripts\server.ps1 restart
```

Opsiyonlar:

```powershell
.\scripts\server.ps1 start -Port 8000 -Host 127.0.0.1 -Reload
.\scripts\server.ps1 start -Port 8000 -Force
```

Notlar:

- PID dosyasi: `.runtime/backend-8000.pid`
- Log dosyalari:
  - `backend-8000.out.log`
  - `backend-8000.err.log`

CMD kisayollari da var:

```cmd
scripts\status_server.cmd
scripts\start_server.cmd
scripts\stop_server.cmd
scripts\restart_server.cmd
```

## Frontend Dev Server Scripts (Windows PowerShell)

Admin ve employee frontend dev serverlarini tek komutla ac/kapatabilirsin.
Varsayilan portlar:
- admin: 5173
- employee: 5174

Komutlar:

```powershell
.\scripts\status_frontend.ps1
.\scripts\start_frontend.ps1
.\scripts\stop_frontend.ps1
.\scripts\restart_frontend.ps1
```

Tek script ile:

```powershell
.\scripts\frontend.ps1 status -Target all
.\scripts\frontend.ps1 start -Target all
.\scripts\frontend.ps1 stop -Target all
.\scripts\frontend.ps1 restart -Target all
```

Tek taraf acmak icin:

```powershell
.\scripts\frontend.ps1 start -Target admin
.\scripts\frontend.ps1 start -Target employee
```

CMD kisayollari:

```cmd
scripts\status_frontend.cmd
scripts\start_frontend.cmd
scripts\stop_frontend.cmd
scripts\restart_frontend.cmd
```

## Tum Servisler (Backend + Frontend) Tek Komut

```powershell
.\scripts\status_all.ps1
.\scripts\start_all.ps1
.\scripts\stop_all.ps1
.\scripts\restart_all.ps1
```

CMD:

```cmd
scripts\status_all.cmd
scripts\start_all.cmd
scripts\stop_all.cmd
scripts\restart_all.cmd
```
