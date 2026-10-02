# 🎵 Sur — Deploy Guide (Bangla)

**তোমার সুর, তোমার মিউজিক** — YouTube Music-এর মতো dekhte, **ashol full gan** bajano jay emon music player.

**Eta ki kore:**
- Search, Trending, Moods & Genres, Albums, Artists, Playlists — shob ashol YouTube Music data (`ytmusicapi`)
- Prottek gan **full length** bajbe (`yt-dlp` diye ashol audio stream)
- Lyrics, Up Next queue, Like (library), mini + full player

---

## Option A — FREE hosting (Render, recommended)

Kono taka lagbe na. Render-er free plan-e chole.

**Tumi ja korba (5 min):**
1. [render.com](https://render.com)-এ free account kholo (GitHub/Google diye login)
2. Dashboard → Account Settings → **API Keys** → ekta key banao

**Baki-ta ami kore dicchi:** GitHub-এ code upload, Render-এ service banano, ar tomar domain-er subdomain-e bosano.

**Mone rekho:** free plan-e 15 min keu na chalale server ghumay jay — prothom request-e 30–50 sec lagte pare. Eta avoid korte ami auto keep-alive bosiye dibo.

## Option B — Tomar VPS (Hostinger)

### Step 1 — Zip VPS-এ upload koro

`sur-music-vps.zip` file-ta VPS-এ pathao:

```bash
scp sur-music-vps.zip root@TOMAR_VPS_IP:/root/
```
(noyto Hostinger File Manager diye upload koro)

### Step 2 — VPS-এ unzip + setup script chalao

```bash
cd /root
unzip -o sur-music-vps.zip -d sur-pkg
cd sur-pkg
bash deploy/setup.sh
```

Script-ta nije nije korbe:
1. Python + venv install
2. `/opt/sur`-এ app copy
3. `pip install` (flask, ytmusicapi, yt-dlp, gunicorn)
4. systemd service install + start (server reboot holeo nije chalu hobe)

Sesh hole dekhabe: `Done! Open in browser: http://VPS_IP:5000`

### Step 3 — Test koro

Browser-এ kholo: **http://VPS_IP:5000**

1. Search icon → `arijit singh` likho → gan list ashbe
2. Ekta gan-e tap koro → **full gan bajbe** (loading-e 5–10 sec lagte pare, prothombar stream ber korte hoy)
3. Player khule Up next / Lyrics tab check koro

### Dorkari commands

```bash
# live log dekho
sudo journalctl -u sur -f

# restart
sudo systemctl restart sur

# notun version upload korle (zip bodlale)
cd /root/sur-pkg && unzip -o /root/sur-music-vps.zip -d .
sudo cp -r app.py requirements.txt static /opt/sur/
sudo systemctl restart sur
```

### Domain + HTTPS (optional, VPS)

1. Cloudflare-এ subdomain-এর A record → VPS IP (proxy ON korle free HTTPS)
2. Chaile `deploy/nginx-snippet.conf` use kore nginx-er pichone boshate paro

---

## Mone rakhar moto

- Login **lage na** — search/play shob public data diye chole
- Stream URL 5 ghonta cache thake, tarpor nije refresh hoy
- Ek IP theke minute-e 30-tar beshi stream request gele 429 ashbe (abuse protection) — normal use-e kokhono lagbe na
- Eta personal use-er jonno banano
