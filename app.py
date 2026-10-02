"""
Sur — backend (ytmusicapi + yt-dlp)
Powered by ytmusicapi (search, browse, playlists, lyrics, queue)
Audio stream URLs resolved with yt-dlp (android client) because
ytmusicapi returns signatureCipher'd URLs that browsers can't play directly.
"""
import os
import time
import threading
import requests
from flask import Flask, jsonify, request, send_from_directory

from ytmusicapi import YTMusic
from yt_dlp import YoutubeDL
from yt_dlp.utils import DownloadError

app = Flask(__name__, static_folder="static", static_url_path="")

yt = YTMusic()  # public data needs no login

# ---------------------------------------------------------------- stream cache
_stream_cache = {}          # videoId -> (url, title, fetched_at)
_cache_lock = threading.Lock()
CACHE_TTL = 5 * 3600        # googlevideo URLs live ~6h; refresh a bit earlier


# ------------------------------------------------------- tiny rate limiter
# /api/song resolves a yt-dlp stream (costly + abusable) — keep per-IP use sane.
_rl_hits = {}
_rl_lock = threading.Lock()
RL_MAX, RL_WINDOW = 30, 60  # 30 stream resolves per IP per minute


def _rate_limited(ip):
    now = time.time()
    with _rl_lock:
        hits = [h for h in _rl_hits.get(ip, []) if now - h < RL_WINDOW]
        if len(hits) >= RL_MAX:
            _rl_hits[ip] = hits
            return True
        hits.append(now)
        _rl_hits[ip] = hits
        return False


def _ydl_opts(no_verify=False):
    return {
        "quiet": True,
        "no_warnings": True,
        "format": "bestaudio/best",
        "skip_download": True,
        "nocheckcertificate": no_verify,
        "extractor_args": {"youtube": {"player_client": ["android"]}},
    }


def resolve_stream(video_id):
    """Return a directly-playable audio URL for a videoId (cached)."""
    now = time.time()
    with _cache_lock:
        hit = _stream_cache.get(video_id)
        if hit and now - hit[2] < CACHE_TTL:
            return hit[0], hit[1]
    url = f"https://music.youtube.com/watch?v={video_id}"
    info = None
    try:
        with YoutubeDL(_ydl_opts()) as ydl:
            info = ydl.extract_info(url, download=False)
    except Exception as e:
        # sandbox/strict networks: retry without cert verification
        if "certificate" in str(e).lower() or "ssl" in str(e).lower():
            with YoutubeDL(_ydl_opts(no_verify=True)) as ydl:
                info = ydl.extract_info(url, download=False)
        else:
            raise
    stream_url = info.get("url")
    title = info.get("title")
    if not stream_url:
        raise DownloadError("no playable URL found")
    with _cache_lock:
        _stream_cache[video_id] = (stream_url, title, now)
    return stream_url, title


# ------------------------------------------------------------------ helpers
def thumb(thumbs, w=544):
    if not thumbs:
        return ""
    # pick the largest available thumbnail
    best = max(thumbs, key=lambda t: t.get("width", 0))
    return best.get("url", "")


def clean_track(t):
    artists = ", ".join(a.get("name", "") for a in (t.get("artists") or []))
    album = (t.get("album") or {}).get("name", "")
    return {
        "videoId": t.get("videoId"),
        "title": t.get("title"),
        "artists": artists,
        "album": album,
        "duration": t.get("duration") or t.get("length"),
        "duration_seconds": t.get("duration_seconds"),
        "thumbnail": thumb(t.get("thumbnails")),
        "videoType": t.get("videoType"),
    }


def clean_search_item(r):
    rtype = r.get("resultType", "")
    artists = ", ".join(a.get("name", "") for a in (r.get("artists") or []))
    base = {
        "type": rtype,
        "title": r.get("title"),
        "artists": artists,
        "thumbnail": thumb(r.get("thumbnails")),
        "duration": r.get("duration"),
    }
    if rtype in ("song", "video"):
        base["videoId"] = r.get("videoId")
        base["album"] = (r.get("album") or {}).get("name", "")
    elif rtype == "album":
        base["browseId"] = r.get("browseId")
        base["year"] = r.get("year")
    elif rtype == "artist":
        base["browseId"] = r.get("browseId")
        base["subscribers"] = r.get("subscribers")
    elif rtype == "playlist":
        base["browseId"] = r.get("browseId")
        base["author"] = r.get("author")
    return base


# ------------------------------------------------------------------- routes
@app.get("/")
def index():
    return send_from_directory("static", "index.html")


@app.get("/api/search")
def api_search():
    q = request.args.get("q", "").strip()
    f = request.args.get("filter") or None
    if not q:
        return jsonify({"error": "missing q"}), 400
    try:
        results = yt.search(q, filter=f, limit=25)
    except Exception as e:
        return jsonify({"error": str(e)}), 502
    return jsonify([clean_search_item(r) for r in results])


@app.get("/api/suggest")
def api_suggest():
    q = request.args.get("q", "").strip()
    if not q:
        return jsonify([])
    try:
        return jsonify(yt.get_search_suggestions(q)[:8])
    except Exception as e:
        return jsonify({"error": str(e)}), 502


@app.get("/api/home")
def api_home():
    """Trending videos + mood categories for the home screen."""
    out = {}
    try:
        charts = yt.get_charts(country="ZZ")
        trending = []
        for shelf in charts.get("videos", []):
            pid = shelf.get("playlistId")
            if pid:
                pl = yt.get_playlist(pid, limit=15)
                for t in pl.get("tracks", [])[:15]:
                    trending.append(clean_track(t))
                break
        out["trending"] = trending
        out["trending_title"] = "Trending Now"
    except Exception as e:
        out["trending"] = []
        out["trending_error"] = str(e)
    try:
        moods = yt.get_mood_categories()
        out["moods"] = [
            {"title": m["title"], "params": m["params"]}
            for m in moods.get("Moods & moments", [])[:12]
        ]
        out["genres"] = [
            {"title": m["title"], "params": m["params"]}
            for m in moods.get("Genres", [])[:12]
        ]
        charts2 = charts  # reuse
        out["artists"] = [
            {"name": a.get("title"), "browseId": a.get("browseId"),
             "thumbnail": thumb(a.get("thumbnails")),
             "subscribers": a.get("subscribers")}
            for a in (charts2.get("artists") or [])[:12]
        ]
    except Exception:
        out["moods"], out["genres"] = [], []
        out["artists"] = []
    return jsonify(out)


@app.get("/api/mood")
def api_mood():
    params = request.args.get("params", "")
    if not params:
        return jsonify({"error": "missing params"}), 400
    try:
        pls = yt.get_mood_playlists(params)[:24]
    except Exception as e:
        return jsonify({"error": str(e)}), 502
    return jsonify([
        {"title": p.get("title"), "playlistId": p.get("playlistId"),
         "thumbnail": thumb(p.get("thumbnails")),
         "description": p.get("description", "")}
        for p in pls
    ])


@app.get("/api/song/<video_id>")
def api_song(video_id):
    """Metadata + playable stream URL for one song."""
    if _rate_limited(request.remote_addr or "unknown"):
        return jsonify({"error": "rate limited — slow down a bit"}), 429
    try:
        stream_url, dl_title = resolve_stream(video_id)
    except Exception as e:
        return jsonify({"error": f"stream failed: {e}"}), 502
    meta = {}
    try:
        info = yt.get_song(video_id)
        vd = info.get("videoDetails", {})
        meta = {
            "title": vd.get("title") or dl_title,
            "author": vd.get("author"),
            "length_seconds": int(vd.get("lengthSeconds", 0) or 0),
            "thumbnail": f"https://i.ytimg.com/vi/{video_id}/hqdefault.jpg",
        }
    except Exception:
        meta = {"title": dl_title, "thumbnail": f"https://i.ytimg.com/vi/{video_id}/hqdefault.jpg"}
    meta.update({"videoId": video_id, "stream_url": stream_url})
    return jsonify(meta)


@app.get("/api/queue/<video_id>")
def api_queue(video_id):
    """Autoplay/radio queue for a song (what plays next)."""
    try:
        w = yt.get_watch_playlist(videoId=video_id, limit=40)
    except Exception as e:
        return jsonify({"error": str(e)}), 502
    return jsonify({
        "playlistId": w.get("playlistId"),
        "lyricsBrowseId": w.get("lyrics"),
        "tracks": [clean_track(t) for t in w.get("tracks", [])],
    })


@app.get("/api/lyrics")
def api_lyrics():
    browse_id = request.args.get("browseId", "")
    if not browse_id:
        return jsonify({"error": "missing browseId"}), 400
    try:
        data = yt.get_lyrics(browse_id)
    except Exception as e:
        return jsonify({"error": str(e)}), 502
    return jsonify({"lyrics": data.get("lyrics", ""), "source": data.get("source", "")})


@app.get("/api/synced-lyrics")
def api_synced_lyrics():
    """Timestamped (LRC) lyrics via LRCLIB for the glowing active-line view.
    Returns {"synced": "[00:12.34] line..."} or {"synced": None}."""
    artist = request.args.get("artist", "").strip().split(",")[0].strip()
    title = request.args.get("title", "").strip()
    if not artist or not title:
        return jsonify({"synced": None})
    try:
        r = requests.get("https://lrclib.net/api/get",
                         params={"artist_name": artist, "track_name": title},
                         timeout=15, headers={"User-Agent": "Sur/1.0"})
        if r.status_code == 200:
            d = r.json()
            if d.get("syncedLyrics"):
                return jsonify({"synced": d["syncedLyrics"], "source": "lrclib"})
    except Exception:
        pass
    return jsonify({"synced": None})


@app.get("/api/playlist/<playlist_id>")
def api_playlist(playlist_id):
    try:
        pl = yt.get_playlist(playlist_id, limit=100)
    except Exception as e:
        return jsonify({"error": str(e)}), 502
    return jsonify({
        "title": pl.get("title"),
        "description": pl.get("description", ""),
        "author": (pl.get("author") or {}).get("name", "") if isinstance(pl.get("author"), dict) else pl.get("author", ""),
        "thumbnail": thumb(pl.get("thumbnails")),
        "trackCount": pl.get("trackCount"),
        "tracks": [clean_track(t) for t in pl.get("tracks", []) if t.get("videoId")],
    })


@app.get("/api/album/<browse_id>")
def api_album(browse_id):
    try:
        al = yt.get_album(browse_id)
    except Exception as e:
        return jsonify({"error": str(e)}), 502
    return jsonify({
        "title": al.get("title"),
        "artists": ", ".join(a.get("name", "") for a in (al.get("artists") or [])),
        "year": al.get("year"),
        "thumbnail": thumb(al.get("thumbnails")),
        "trackCount": al.get("trackCount"),
        "tracks": [clean_track(t) for t in al.get("tracks", []) if t.get("videoId")],
    })


@app.get("/api/artist/<channel_id>")
def api_artist(channel_id):
    try:
        ar = yt.get_artist(channel_id)
    except Exception as e:
        return jsonify({"error": str(e)}), 502
    out = {
        "name": ar.get("name"),
        "thumbnail": thumb(ar.get("thumbnails")),
        "subscribers": ar.get("subscribers"),
        "songs": [],
        "albums": [],
    }
    songs = (ar.get("songs") or {})
    for t in (songs.get("results") or [])[:10]:
        if t.get("videoId"):
            out["songs"].append(clean_track(t))
    for sec in ("albums", "singles"):
        alb = (ar.get(sec) or {})
        for a in (alb.get("results") or [])[:10]:
            out["albums"].append({
                "title": a.get("title"), "browseId": a.get("browseId"),
                "year": a.get("year"), "thumbnail": thumb(a.get("thumbnails")),
            })
    return jsonify(out)


@app.get("/api/health")
def api_health():
    return jsonify({"ok": True})


if __name__ == "__main__":
    port = int(os.environ.get("PORT", "5000"))
    app.run(host="0.0.0.0", port=port, threaded=True)
