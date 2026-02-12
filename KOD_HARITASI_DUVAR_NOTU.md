# PUANTAJ MVP - DUVAR NOTU (KOD HARITASI)

Bu not, projenin ana kodlarini hizli hatirlamak icin hazirlandi.
Hedef: "Nerede ne var?" sorusunu 30-60 saniyede cevaplamak.

## 1) Ana klasorler

- `app/` : FastAPI backend
- `web-admin/` : React admin panel
- `web-employee/` : React employee portal
- `app/static/admin` ve `app/static/employee` : build ciktilari

## 2) Request akisinin cekirdegi

### 2.1 FastAPI giris noktasi
Dosya: `app/main.py`

```python
app = FastAPI(title=settings.app_name, version="0.1.0")
app.add_middleware(CORSMiddleware, ...)
app.include_router(attendance.router)
app.include_router(admin.router)
mount_spa(app, url_prefix="/admin-panel", ...)
mount_spa(app, url_prefix="/employee", ...)
```

Aciklama:
- Tum API route'lari burada birlesir.
- Admin ve employee SPA ayni domain altinda servis edilir.

### 2.2 Request log + request_id
Dosya: `app/main.py`

```python
@app.middleware("http")
async def request_middleware(request, call_next):
    request_id = request.headers.get("X-Request-Id") or str(uuid4())
    ...
    logger.info("request_complete", extra={...})
```

Aciklama:
- Her istege request_id verir.
- Latency, endpoint, status, actor bilgisi loglanir.

## 3) Veritabani omurgasi

Dosya: `app/models.py`

Kritik tablolar:
- `employees`, `devices`, `attendance_events`
- `departments`, `work_rules`, `department_shifts`, `department_weekly_rules`
- `device_invites`, `audit_logs`, `admin_users`, `admin_refresh_tokens`
- `qr_codes`, `qr_points`, `qr_code_points`

Kritik enumlar:
- `AttendanceType`: `IN`, `OUT`
- `LocationStatus`: `VERIFIED_HOME`, `UNVERIFIED_LOCATION`, `NO_LOCATION`
- `AttendanceEventSource`: `DEVICE`, `MANUAL`

## 4) Attendance business logic (en kritik servis)

Dosya: `app/services/attendance.py`

### 4.1 Check-in / Check-out kaydi
```python
def create_checkin_event(...):
    return _build_attendance_event(..., event_type=AttendanceType.IN, ...)

def create_checkout_event(..., manual: bool = False):
    extra_flags = {"MANUAL_CHECKOUT": True} if manual else None
    return _build_attendance_event(..., event_type=AttendanceType.OUT, extra_flags=extra_flags)
```

Aciklama:
- Tum event olusturma `_build_attendance_event` icinde toplanir.
- Duplicate kontrolu, shift secimi, flag uretimi burada yapilir.

### 4.2 Device dogrulama
```python
def _resolve_active_device(db, device_fingerprint):
    device = db.scalar(select(Device).where(
        Device.device_fingerprint == device_fingerprint,
        Device.is_active.is_(True),
    ))
```

Aciklama:
- Employee islemlerinde ilk kontrol aktif cihazdir.
- Pasif employee / cihaz ise islem kesilir.

### 4.3 QR tabanli event
```python
def create_employee_qr_scan_event(...):
    qr_code = _resolve_qr_code_by_value(...)
    active_points = _load_active_qr_points_for_code(...)
    # en yakin ve radius icindeki nokta secilir
```

Aciklama:
- QR kod + konum birlikte degerlendirilir.
- Nokta disinda ise `QRScanDeniedError` doner.

## 5) Konum kurali (guncel durum)

Dosya: `app/services/location.py`

```python
def evaluate_location(employee_location, lat, lon):
    if lat is None or lon is None:
        return LocationStatus.NO_LOCATION, {"reason": "no_location_payload"}
    return LocationStatus.VERIFIED_HOME, {}
```

Aciklama:
- Ev-konumu dogrulama akisi pasif.
- Lat/lon varsa status su anda dogrudan "verified" doner.

## 6) Admin auth + yetki

Dosya: `app/security.py`

```python
def require_admin(credentials=Depends(bearer_scheme)):
    payload = decode_token(credentials.credentials, expected_type="access")
    ...
    return payload
```

```python
def require_admin_permission(permission: str, write: bool = False):
    ...
```

Aciklama:
- JWT access token ile admin korumasi.
- Yetki bazli endpoint kontrolu (`read` / `write`).

## 7) Router haritasi

### 7.1 Employee API
Dosya: `app/routers/attendance.py`
- `/api/device/claim`
- `/api/attendance/checkin`
- `/api/attendance/checkout`
- `/api/employee/qr/scan`
- `/api/employee/status`

### 7.2 Admin API
Dosya: `app/routers/admin.py`
- `/api/admin/auth/*`
- `/admin/*` ve `/api/admin/*` yonetim endpointleri
- rapor, export, qr, schedule, audit, manual override endpointleri

## 8) Frontend giris noktasi

### 8.1 Admin UI
Dosya: `web-admin/src/main.tsx`
- React Router + React Query + AuthProvider

### 8.2 Employee UI
Dosya: `web-employee/src/main.tsx`
- BrowserRouter (basename), PWA service worker register

## 9) Sistem standartlari (kisa ozet)

- Zaman damgasi DB'de UTC tutulur.
- Yerel gun hesaplari `Europe/Istanbul` ile yapilir.
- Kritik aksiyonlar `audit_logs` tablosuna yazilir.
- Silme islemleri cok yerde soft-delete mantigiyla ilerler.
- API hata cevabi standarttir: `error.code`, `error.message`, `request_id`.

## 10) Ariza oldugunda ilk bakilacak yerler

1. `app/main.py` middleware loglari
2. `app/services/attendance.py` (event kurallari)
3. `app/services/location.py` (konum karari)
4. `app/security.py` (401/403)
5. `app/routers/admin.py` ve `app/routers/attendance.py` (endpoint akisi)

