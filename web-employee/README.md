# web-employee (PWA)

Telefon odakli calisan portali.

Kullandigi backend endpointleri:
- `POST /api/device/claim`
- `POST /api/attendance/checkin`
- `POST /api/attendance/checkout`

## Gelistirme

```powershell
npm install
npm run dev
```

Varsayilan API:
- `.env.example` icindeki `VITE_API_BASE_URL=http://127.0.0.1:8000`
- Ayarlanmazsa `window.location.origin` kullanilir.

## Uretim build

```powershell
npm run build
```

Build sonrasi dosyalar otomatik kopyalanir:
- `../app/static/employee`

## Kullanici akisi

1. Calisan davet linki ile acilir:
   - `/employee/claim?token=XXXX`
2. Portal stabil `device_fingerprint` uretir ve claim eder.
3. Ana ekranda:
   - `QR ile Giris` (kamera tarama / manuel QR metni)
   - `Mesaiyi Bitir` (manuel cikis)
4. Sonuc ekraninda:
   - `Evde Onayli / Ev Disi / Konum Yok`
   - `Mukerrer kayit / Manuel cikis / Ev konumu tanimli degil`
