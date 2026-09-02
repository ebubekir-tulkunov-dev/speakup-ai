"""DashScope qwen3-rerank for refining near-duplicate question matches."""

from __future__ import annotations

import httpx

from app.config import settings


async def rerank(
    query: str,
    documents: list[str],
    *,
    top_n: int | None = None,
) -> list[dict]:
    """Return list of {index, score, document?} sorted by relevance desc."""
    if not documents:
        return []
    if not settings.dashscope_api_key:
        raise RuntimeError("DASHSCOPE_API_KEY is not configured")

    url = f"{settings.dashscope_http_base.rstrip('/')}/services/rerank/text-rerank/text-rerank"
    n = top_n or min(len(documents), 10)
    payload = {
        "model": settings.qwen_rerank_model,
        "input": {
            "query": query,
            "documents": documents,
        },
        "parameters": {
            "return_documents": False,
            "top_n": n,
        },
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
            raise RuntimeError(f"Qwen rerank error {res.status_code}: {res.text[:500]}")
        data = res.json()

    results = (data.get("output") or {}).get("results") or []
    out: list[dict] = []
    for r in results:
        out.append(
            {
                "index": int(r.get("index", 0)),
                "score": float(r.get("relevance_score") or r.get("score") or 0.0),
            }
        )
    out.sort(key=lambda x: x["score"], reverse=True)
    return out
