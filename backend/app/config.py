from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

_DEFAULT_STORAGE_DIR = Path(__file__).resolve().parent / "storage"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="APP_", env_file=".env", extra="ignore")

    storage_dir: Path = _DEFAULT_STORAGE_DIR
    database_url: str = f"sqlite:///{_DEFAULT_STORAGE_DIR / 'app.db'}"
    allow_local_gateway_urls: bool = False
    gateway_timeout_seconds: float = 180.0
    max_gateway_response_bytes: int = 4_000_000


settings = Settings()
