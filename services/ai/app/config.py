import os
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

# Alibaba Cloud Model Studio — uluslararası OpenAI uyumlu endpoint
DASHSCOPE_INTL_BASE = "https://dashscope-intl.aliyuncs.com/compatible-mode/v1"


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

    dashscope_api_key: str = ""
    dashscope_api_base: str = DASHSCOPE_INTL_BASE
    qwen_model: str = "qwen3.5-flash"
    cors_origins: str = "http://localhost:5173,http://127.0.0.1:5173"

    @property
    def cors_origin_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]


settings = Settings()


def configure_dashscope_env() -> None:
    """langchain-qwq ve OpenAI uyumlu istemciler için ortam değişkenlerini ayarla."""
    base = settings.dashscope_api_base or DASHSCOPE_INTL_BASE
    os.environ["DASHSCOPE_API_BASE"] = base
    if settings.dashscope_api_key:
        os.environ["DASHSCOPE_API_KEY"] = settings.dashscope_api_key


configure_dashscope_env()
