import httpx

from app.config import settings


async def ai_post(path: str, payload: dict) -> dict:
    url = f"{settings.ai_service_url.rstrip('/')}{path}"
    async with httpx.AsyncClient(timeout=120.0) as client:
        res = await client.post(url, json=payload)
        if res.status_code == 401:
            raise ValueError("DashScope API anahtarı geçersiz. DASHSCOPE_API_KEY kontrol edin.")
        res.raise_for_status()
        return res.json()
