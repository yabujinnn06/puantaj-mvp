# web-admin

Puantaj sisteminin admin arayuzu (React + Vite + TypeScript).

## Gelistirme

```bash
npm install
npm run dev
```

Varsayilan Vite adresi: `http://127.0.0.1:5173`

API adresi `.env` dosyasindan okunur:

```env
VITE_API_BASE_URL=http://127.0.0.1:8000
```

## Build ve backend static kopyalama

```bash
npm run build
```

Bu komut:
1. Frontend build alir
2. Ciktiyi `../app/static/admin` klasorune kopyalar

Backend uzerinden panel:
- `http://127.0.0.1:8000/admin-panel/`

## Manuel Test Adimlari (Turkce)

### 1) Excel disa aktarma testi
1. Admin panelde `Excel Disa Aktar` sayfasina gidin.
2. `Disa aktarma tipi` secin (Calisan / Departman / Tum Calisanlar / Tarih Araligi).
3. Gerekli filtreleri doldurun ve `Excel Indir` butonuna basin.
4. Inen `.xlsx` dosyasini acip sheetlerin dolu geldigini kontrol edin.

### 2) Manuel override testi
1. `Aylik Calisan Raporu` ekranina gidin.
2. Bir calisan, yil ve ay secip `Uygula` butonuna basin.
3. Tabloda bir gun satirinda `Gunu Duzenle` butonuna basin.
4. Giris/cikis saatlerini veya `Gelmedi` secenegini girip kaydedin.
5. Satirda `MANUEL` rozetinin gorundugunu ve toplamlarin guncellendigini dogrulayin.

### 3) Calisan pasife alma / tekrar aktif etme testi
1. `Calisanlar` sayfasina gidin.
2. Durum filtresinden `Aktif` seciliyken bir calisanda `Pasife Al` butonuna basin.
3. Filtreden `Pasif` secip calisanin listede oldugunu kontrol edin.
4. Ayni satirda `Aktif Et` ile geri acin ve `Aktif` listesinde tekrar gorundugunu dogrulayin.
