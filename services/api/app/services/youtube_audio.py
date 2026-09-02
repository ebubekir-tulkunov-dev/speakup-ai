"""YouTube → audio extractor (yt-dlp), adapted from simple-downloader."""

from __future__ import annotations

import os
import re
from pathlib import Path

import certifi

os.environ.setdefault("SSL_CERT_FILE", certifi.where())
os.environ.setdefault("REQUESTS_CA_BUNDLE", certifi.where())

import yt_dlp

_YT_ID_RE = re.compile(
    r"(?:youtu\.be/|youtube\.com/(?:watch\?v=|embed/|shorts/|live/))([A-Za-z0-9_-]{11})"
)


def extract_youtube_id(url: str) -> str | None:
    m = _YT_ID_RE.search(url)
    return m.group(1) if m else None


def fetch_metadata(url: str) -> dict:
    opts = {
        "quiet": True,
        "no_warnings": True,
        "skip_download": True,
        "noplaylist": True,
    }
    with yt_dlp.YoutubeDL(opts) as ydl:
        info = ydl.extract_info(url, download=False)
    if not info:
        raise RuntimeError("Could not fetch YouTube metadata")
    return {
        "id": info.get("id"),
        "title": info.get("title") or "Untitled",
        "channel": info.get("uploader") or info.get("channel"),
        "duration": info.get("duration"),
        "thumbnail": info.get("thumbnail"),
    }


def download_audio(url: str, output_dir: Path) -> Path:
    """Download best audio and convert to mp3. Returns path to the mp3 file."""
    output_dir.mkdir(parents=True, exist_ok=True)
    outtmpl = str(output_dir / "%(id)s.%(ext)s")

    opts: dict = {
        "format": "bestaudio/best",
        "outtmpl": outtmpl,
        "noplaylist": True,
        "quiet": True,
        "no_warnings": True,
        "postprocessors": [
            {
                "key": "FFmpegExtractAudio",
                "preferredcodec": "mp3",
                "preferredquality": "192",
            }
        ],
    }

    with yt_dlp.YoutubeDL(opts) as ydl:
        info = ydl.extract_info(url, download=True)
        if not info:
            raise RuntimeError("Download failed: no info returned")
        video_id = info.get("id") or "audio"
        mp3_path = output_dir / f"{video_id}.mp3"
        if not mp3_path.exists():
            # yt-dlp may leave a different name; search the dir
            candidates = list(output_dir.glob(f"{video_id}.*"))
            audio_exts = {".mp3", ".m4a", ".webm", ".opus", ".ogg", ".wav"}
            for c in candidates:
                if c.suffix.lower() in audio_exts:
                    return c
            raise RuntimeError(f"Audio file not found after download (expected {mp3_path})")
        return mp3_path
