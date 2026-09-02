"""YouTube podcast import: download audio → Deepgram diarized transcript."""

from __future__ import annotations

import asyncio
import logging
import shutil
import tempfile
from datetime import datetime
from pathlib import Path

from beanie.operators import In
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from app.config import settings
from app.models import PodcastEpisode
from app.services.deepgram_transcribe import transcribe_with_diarization
from app.services.youtube_audio import download_audio, extract_youtube_id, fetch_metadata

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/podcast", tags=["podcast"])


class ImportBody(BaseModel):
    url: str = Field(..., min_length=10)
    language: str = "en"


def _episode_dict(ep: PodcastEpisode) -> dict:
    return {
        "id": str(ep.id),
        "youtube_url": ep.youtube_url,
        "youtube_id": ep.youtube_id,
        "title": ep.title,
        "channel": ep.channel,
        "duration_sec": ep.duration_sec,
        "status": ep.status,
        "error": ep.error,
        "speaker_count": ep.speaker_count,
        "utterances": ep.utterances if ep.status == "ready" else [],
        "full_text": ep.full_text if ep.status == "ready" else "",
        "created_at": ep.created_at.isoformat() if ep.created_at else None,
        "updated_at": ep.updated_at.isoformat() if ep.updated_at else None,
    }


def _tmp_root() -> Path:
    if settings.podcast_tmp_dir:
        root = Path(settings.podcast_tmp_dir)
    else:
        root = Path(tempfile.gettempdir()) / "speakup-podcast"
    root.mkdir(parents=True, exist_ok=True)
    return root


async def _process_episode(episode_id: str, language: str) -> None:
    ep = await PodcastEpisode.get(episode_id)
    if not ep:
        return

    work_dir = _tmp_root() / episode_id
    try:
        ep.status = "downloading"
        ep.updated_at = datetime.utcnow()
        await ep.save()

        # yt-dlp is blocking — run in thread
        audio_path = await asyncio.to_thread(download_audio, ep.youtube_url, work_dir)

        ep.status = "transcribing"
        ep.updated_at = datetime.utcnow()
        await ep.save()

        result = await transcribe_with_diarization(
            audio_path,
            settings.deepgram_api_key,
            language=language,
        )

        ep.utterances = result["utterances"]
        ep.full_text = result["full_text"]
        ep.speaker_count = result["speaker_count"]
        ep.status = "ready"
        ep.error = None
        ep.updated_at = datetime.utcnow()
        await ep.save()
    except Exception as e:
        logger.exception("Podcast processing failed for %s", episode_id)
        ep.status = "failed"
        ep.error = str(e)[:800]
        ep.updated_at = datetime.utcnow()
        await ep.save()
    finally:
        shutil.rmtree(work_dir, ignore_errors=True)


@router.get("/episodes")
async def list_episodes():
    episodes = (
        await PodcastEpisode.find(PodcastEpisode.user_id == settings.default_user_id)
        .sort(-PodcastEpisode.created_at)
        .to_list()
    )
    return {
        "items": [
            {
                "id": str(e.id),
                "title": e.title,
                "channel": e.channel,
                "youtube_url": e.youtube_url,
                "duration_sec": e.duration_sec,
                "status": e.status,
                "speaker_count": e.speaker_count,
                "error": e.error,
                "preview": (e.full_text[:140] + "…") if e.full_text else "",
                "created_at": e.created_at.isoformat() if e.created_at else None,
            }
            for e in episodes
        ]
    }


@router.get("/episodes/{episode_id}")
async def get_episode(episode_id: str):
    ep = await PodcastEpisode.get(episode_id)
    if not ep or ep.user_id != settings.default_user_id:
        raise HTTPException(404, "Episode not found")
    return _episode_dict(ep)


@router.post("/import")
async def import_podcast(body: ImportBody):
    if not settings.deepgram_api_key:
        raise HTTPException(503, "DEEPGRAM_API_KEY is not configured")

    url = body.url.strip()
    yt_id = extract_youtube_id(url)
    if not yt_id and "youtube.com" not in url and "youtu.be" not in url:
        raise HTTPException(400, "Please paste a valid YouTube URL")

    # Reuse existing ready episode for same video
    if yt_id:
        existing = await PodcastEpisode.find_one(
            PodcastEpisode.user_id == settings.default_user_id,
            PodcastEpisode.youtube_id == yt_id,
            PodcastEpisode.status == "ready",
        )
        if existing:
            return _episode_dict(existing)

        # Already processing?
        busy = await PodcastEpisode.find_one(
            PodcastEpisode.user_id == settings.default_user_id,
            PodcastEpisode.youtube_id == yt_id,
            In(PodcastEpisode.status, ["pending", "downloading", "transcribing"]),
        )
        if busy:
            return _episode_dict(busy)

    try:
        meta = await asyncio.to_thread(fetch_metadata, url)
    except Exception as e:
        raise HTTPException(400, f"Could not read YouTube video: {e}") from e

    ep = PodcastEpisode(
        user_id=settings.default_user_id,
        youtube_url=url,
        youtube_id=meta.get("id") or yt_id,
        title=meta.get("title") or "Untitled podcast",
        channel=meta.get("channel"),
        duration_sec=float(meta["duration"]) if meta.get("duration") else None,
        status="pending",
    )
    await ep.insert()

    asyncio.create_task(_process_episode(str(ep.id), body.language))

    return _episode_dict(ep)


@router.delete("/episodes/{episode_id}")
async def delete_episode(episode_id: str):
    ep = await PodcastEpisode.get(episode_id)
    if not ep or ep.user_id != settings.default_user_id:
        raise HTTPException(404, "Episode not found")
    await ep.delete()
    return {"ok": True}
