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

    @property
    def cors_origin_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]


settings = Settings()
