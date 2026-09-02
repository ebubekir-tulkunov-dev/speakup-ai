"""DashScope / Qwen text-embedding-v4 (native DashScope API)."""

from __future__ import annotations

import httpx

from app.config import settings

EMBED_INSTRUCT = (
    "Given a spoken-practice interview question, retrieve previously asked "
    "questions that are semantically the same or nearly duplicate."
)


async def embed_texts(
    texts: list[str],
    *,
    text_type: str = "document",
    instruct: str | None = None,
) -> list[list[float]]:
    if not texts:
        return []
    if not settings.dashscope_api_key:
        raise RuntimeError("DASHSCOPE_API_KEY is not configured")

    vectors: list[list[float]] = []
    for i in range(0, len(texts), 10):
        batch = texts[i : i + 10]
        use_instruct = instruct if text_type == "query" else None
        vectors.extend(await _embed_native(batch, text_type=text_type, instruct=use_instruct))
    return vectors


async def embed_query(text: str) -> list[float]:
    vecs = await embed_texts([text], text_type="query", instruct=EMBED_INSTRUCT)
    return vecs[0]


async def embed_document(text: str) -> list[float]:
    vecs = await embed_texts([text], text_type="document")
    return vecs[0]


async def _embed_native(
    texts: list[str],
    *,
    text_type: str = "document",
    instruct: str | None = None,
) -> list[list[float]]:
    url = f"{settings.dashscope_http_base.rstrip('/')}/services/embeddings/text-embedding/text-embedding"
    params: dict = {
        "text_type": text_type,
        "dimension": settings.qwen_embed_dim,
        "output_type": "dense",
    }
    if instruct and text_type == "query":
        params["instruct"] = instruct

    payload = {
        "model": settings.qwen_embed_model,
        "input": {"texts": texts},
        "parameters": params,
    }

    async with httpx.AsyncClient(timeout=60.0) as client:
        res = await client.post(
            url,
            headers={
                "Authorization": f"Bearer {settings.dashscope_api_key}",
                "Content-Type": "application/json",
            },
            json=payload,
        )
        if res.status_code >= 400:
            raise RuntimeError(f"Qwen embed error {res.status_code}: {res.text[:500]}")
        data = res.json()

    embeddings = (data.get("output") or {}).get("embeddings") or []
    embeddings = sorted(embeddings, key=lambda x: x.get("text_index", 0))
    return [e["embedding"] for e in embeddings]
