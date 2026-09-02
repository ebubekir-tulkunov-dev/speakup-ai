"""Deepgram prerecorded transcription with speaker diarization."""

from __future__ import annotations

from pathlib import Path

import httpx

DEEPGRAM_URL = "https://api.deepgram.com/v1/listen"


async def transcribe_audio_bytes(
    audio_bytes: bytes,
    api_key: str,
    *,
    language: str = "en",
    model: str = "nova-2",
    content_type: str = "audio/webm",
) -> str:
    """Simple STT (no diarization) for short spoken answers."""
    if not api_key:
        raise RuntimeError("DEEPGRAM_API_KEY is not configured")

    params = {
        "model": model,
        "smart_format": "true",
        "punctuate": "true",
        "language": language,
    }

    async with httpx.AsyncClient(timeout=httpx.Timeout(120.0, connect=30.0)) as client:
        res = await client.post(
            DEEPGRAM_URL,
            params=params,
            headers={
                "Authorization": f"Token {api_key}",
                "Content-Type": content_type,
            },
            content=audio_bytes,
        )
        if res.status_code >= 400:
            raise RuntimeError(f"Deepgram error {res.status_code}: {res.text[:500]}")
        data = res.json()

    channels = (data.get("results") or {}).get("channels") or []
    if not channels:
        return ""
    alts = channels[0].get("alternatives") or []
    if not alts:
        return ""
    return (alts[0].get("transcript") or "").strip()


async def transcribe_with_diarization(
    audio_path: Path,
    api_key: str,
    *,
    language: str = "en",
    model: str = "nova-2",
) -> dict:
    if not api_key:
        raise RuntimeError("DEEPGRAM_API_KEY is not configured")

    params = {
        "model": model,
        "smart_format": "true",
        "punctuate": "true",
        "diarize": "true",
        "utterances": "true",
        "language": language,
    }

    suffix = audio_path.suffix.lower()
    content_types = {
        ".mp3": "audio/mpeg",
        ".m4a": "audio/mp4",
        ".wav": "audio/wav",
        ".ogg": "audio/ogg",
        ".webm": "audio/webm",
        ".opus": "audio/ogg",
    }
    content_type = content_types.get(suffix, "application/octet-stream")

    audio_bytes = audio_path.read_bytes()

    async with httpx.AsyncClient(timeout=httpx.Timeout(600.0, connect=30.0)) as client:
        res = await client.post(
            DEEPGRAM_URL,
            params=params,
            headers={
                "Authorization": f"Token {api_key}",
                "Content-Type": content_type,
            },
            content=audio_bytes,
        )
        if res.status_code >= 400:
            raise RuntimeError(f"Deepgram error {res.status_code}: {res.text[:500]}")
        data = res.json()

    return parse_diarized_response(data)


def parse_diarized_response(data: dict) -> dict:
    """Normalize Deepgram response into utterances + full text."""
    results = data.get("results") or {}
    raw_utterances = results.get("utterances") or []

    utterances: list[dict] = []
    for u in raw_utterances:
        text = (u.get("transcript") or "").strip()
        if not text:
            continue
        utterances.append(
            {
                "speaker": int(u.get("speaker", 0)),
                "start": float(u.get("start") or 0),
                "end": float(u.get("end") or 0),
                "text": text,
            }
        )

    # Fallback: build from words with speaker labels if utterances empty
    if not utterances:
        channels = results.get("channels") or []
        if channels:
            alts = channels[0].get("alternatives") or []
            if alts:
                words = alts[0].get("words") or []
                utterances = _group_words_by_speaker(words)
                if not utterances and alts[0].get("transcript"):
                    utterances = [
                        {
                            "speaker": 0,
                            "start": 0.0,
                            "end": 0.0,
                            "text": alts[0]["transcript"].strip(),
                        }
                    ]

    speakers = {u["speaker"] for u in utterances}
    # Remap speakers to 1-based display indices (Speaker 1, 2, 3...)
    ordered = sorted(speakers)
    remap = {s: i + 1 for i, s in enumerate(ordered)}
    for u in utterances:
        u["speaker"] = remap[u["speaker"]]

    full_text = "\n".join(f"Speaker {u['speaker']}: {u['text']}" for u in utterances)

    return {
        "utterances": utterances,
        "full_text": full_text,
        "speaker_count": len(ordered),
    }


def _group_words_by_speaker(words: list[dict]) -> list[dict]:
    if not words:
        return []
    groups: list[dict] = []
    current_speaker = words[0].get("speaker", 0)
    buf: list[str] = []
    start = float(words[0].get("start") or 0)
    end = float(words[0].get("end") or 0)

    def flush(speaker, texts, s, e):
        text = " ".join(texts).strip()
        if text:
            groups.append({"speaker": int(speaker), "start": s, "end": e, "text": text})

    for w in words:
        sp = w.get("speaker", 0)
        token = w.get("punctuated_word") or w.get("word") or ""
        if sp != current_speaker and buf:
            flush(current_speaker, buf, start, end)
            buf = []
            current_speaker = sp
            start = float(w.get("start") or 0)
        buf.append(token)
        end = float(w.get("end") or end)

    flush(current_speaker, buf, start, end)
    return groups
