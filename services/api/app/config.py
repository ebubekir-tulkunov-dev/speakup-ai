from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict


def _env_file() -> str:
    candidates = [
        Path(".env"),
        Path(__file__).resolve().parents[3] / ".env",
        Path(__file__).resolve().parents[2] / ".env",
    ]
    for path in candidates:
        if path.exists():
            return str(path)
    return ".env"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=_env_file(), extra="ignore")

    mongodb_url: str = "mongodb://localhost:27017/dil_programi"
    cors_origins: str = "http://localhost:5173,http://127.0.0.1:5173"
    livekit_url: str = "ws://127.0.0.1:7890"
    livekit_api_key: str = "devkey"
    livekit_api_secret: str = "secret"
    default_user_id: str = "local_user"
    ai_service_url: str = "http://localhost:8001"
    deepgram_api_key: str = ""
    podcast_tmp_dir: str = ""
    dashscope_api_key: str = ""
    dashscope_api_base: str = "https://dashscope-intl.aliyuncs.com/compatible-mode/v1"
    dashscope_http_base: str = "https://dashscope-intl.aliyuncs.com/api/v1"
    qdrant_url: str = "http://localhost:6333"
    qwen_embed_model: str = "text-embedding-v4"
    qwen_embed_dim: int = 1024
    qwen_rerank_model: str = "qwen3-rerank"
    topic_speak_similarity_threshold: float = 0.78

    @property
    def cors_origin_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]


settings = Settings()
