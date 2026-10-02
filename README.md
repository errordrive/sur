# Sur 🎵

**তোমার সুর, তোমার মিউজিক** — YouTube Music-style music player with real, full-length songs.

- Search, Trending, Moods & Genres, Albums, Artists, Playlists (real YouTube Music data via `ytmusicapi`)
- Full-length audio playback (`yt-dlp` stream resolution, cached 5h)
- Lyrics, Up Next queue, Likes library, mini + full player UI

## Run locally

```bash
python3 -m venv venv && ./venv/bin/pip install -r requirements.txt
./venv/bin/python app.py   # http://127.0.0.1:5000
```

## Deploy (free — Render)

1. Push this repo to GitHub (public).
2. Render dashboard → New → Web Service → connect the repo (or use `render.yaml` Blueprint).
3. Build: `pip install -r requirements.txt` · Start: `gunicorn app:app --bind 0.0.0.0:$PORT --workers 2 --threads 4 --timeout 120`
4. Add custom domain `music.nctti.tech` → point the DNS CNAME at the Render URL.

No login needed — all endpoints use public YouTube Music data.
