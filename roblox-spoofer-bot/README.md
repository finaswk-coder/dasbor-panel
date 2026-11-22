# Roblox Spoofer Bot (Discord)

Prefix default: `.`

| Command | Fungsi | API key user? |
|---|---|---|
| `.spoff <id id ...> [anim\|audio]` | Download animasi/lagu dari ID → upload ulang ke akun/grup kamu → kasih ID baru + `mapping.lua` + script command bar buat ganti ID otomatis | **Wajib** |
| `.spoff` + lampiran `.rbxm/.ogg/.mp3` | Upload file langsung ke akun kamu | **Wajib** |
| `.rbxm <id id ...>` | Download jadi file `.rbxm` (animasi) / `.ogg` `.mp3` (lagu) | **Tidak** |
| `.setkey <apikey> <user\|group> <id>` | Simpan API key (kirim via **DM** ke bot) | – |
| `.delkey` | Hapus API key | – |
| `.help` | Bantuan | – |

ID bisa angka polos, `rbxassetid://123`, atau link. Bisa banyak sekaligus (maks 25).

## Anti gagal
- Retry otomatis untuk 429 / 5xx / error jaringan (ikut `Retry-After`)
- Download pakai key user, kalau ditolak otomatis coba key bot
- Auto-deteksi animasi vs audio dari isi file + auto-gunzip
- Polling status upload sampai selesai, cek moderasi
- Kalau tetap gagal: pakai `.rbxm` lalu upload manual lewat Studio, atau `.spoff` + lampirkan file

## Setup di VPS
```bash
# Node.js 18+ wajib
cd roblox-spoofer-bot
npm install
cp .env.example .env
nano .env          # isi DISCORD_TOKEN, BOT_ROBLOX_API_KEY, ENCRYPTION_SECRET
npm start
```
Biar jalan terus: `npm i -g pm2 && pm2 start src/index.js --name spoofer && pm2 save`

**Discord Developer Portal → Bot → nyalakan _Message Content Intent_** (wajib untuk prefix command).

## API key Roblox
create.roblox.com → Dashboard → Open Cloud → API Keys → Create:
- `Assets` → Read & Write
- `Legacy Assets` → `legacy-asset:manage` (untuk download)
- Accepted IP: IP VPS (atau `0.0.0.0/0`)

Key bot (`BOT_ROBLOX_API_KEY`) cukup `legacy-asset:manage`.
Untuk upload ke grup: `.setkey <key> group <groupId>` (key dibuat di bawah grup itu).
