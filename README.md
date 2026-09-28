# BALEREOT COMMUNITY — Public Web

Versi full-stack untuk Cloudflare Workers + D1.

## Fitur
- Branding BALEREOT COMMUNITY
- Login dengan username Roblox yang diverifikasi ke Roblox
- Whitelist/akses berbayar dikelola admin
- Admin: Vellord
- API Key Roblox dimasukkan dari panel admin
- API Key dienkripsi di server menggunakan APP_ENCRYPTION_KEY
- Upload asset ke Roblox Assets API
- Penyimpanan whitelist dan riwayat upload di D1
- Frontend dan backend berada di satu Worker

## Penting
1. Username-only login berarti orang yang mengetahui username yang di-whitelist dapat mencoba masuk. Untuk keamanan lebih tinggi, tambahkan Roblox OAuth 2.0.
2. API key Roblox tidak pernah dikirim ke browser. Roblox mewajibkan x-api-key untuk Assets API.
3. Batas konten upload pada dokumentasi Roblox saat ini adalah 20 MB per request untuk endpoint content upload.
4. Endpoint Assets API ditandai Beta oleh dokumentasi Roblox dan dapat berubah.

## Deploy tanpa Termux
Cloudflare Dashboard -> Workers & Pages -> Create -> Workers.
Namun untuk D1 + file project ini, paling mudah memakai GitHub + Cloudflare build/deploy, atau Wrangler dari PC.

## Secrets yang wajib dibuat
- ADMIN_PASSWORD (disarankan untuk pengembangan/ekspansi admin; versi ini mengenali admin Roblox username Vellord)
- SESSION_SECRET: random panjang
- APP_ENCRYPTION_KEY: 32-byte random key, base64 encoded

Generate APP_ENCRYPTION_KEY di komputer dengan Python:
python -c "import os,base64; print(base64.b64encode(os.urandom(32)).decode())"

Generate SESSION_SECRET:
python -c "import secrets; print(secrets.token_urlsafe(48))"

## D1
Create database:
npx wrangler d1 create balereot-community
Masukkan database_id ke wrangler.json.

Apply schema:
npx wrangler d1 migrations apply balereot-community --remote

Deploy:
npx wrangler deploy

Cloudflare akan memberi URL workers.dev. Custom domain dapat ditambahkan dari dashboard.

## Catatan API Key
Admin memasukkan key di panel. Worker mengenkripsi key sebelum menyimpan ciphertext di D1. APP_ENCRYPTION_KEY harus tetap menjadi Cloudflare Secret.
