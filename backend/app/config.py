from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

_DEFAULT_STORAGE_DIR = Path(__file__).resolve().parent / "storage"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="APP_", env_file=".env", extra="ignore")

    storage_dir: Path = _DEFAULT_STORAGE_DIR
    database_url: str = f"sqlite:///{_DEFAULT_STORAGE_DIR / 'app.db'}"
    allow_local_gateway_urls: bool = False
    gateway_timeout_seconds: float = 600.0
    max_gateway_response_bytes: int = 4_000_000

    # ---- SSO ----
    sso_verify_url: str = "http://127.0.0.1:9000/api/sso/verify"
    sso_client_id: str = "dev-client"
    sso_client_secret: str = "dev-secret-PLACEHOLDER"
    sso_timeout_seconds: float = 5.0
    sso_trusted_origins: list[str] = ["third-party.example.com"]

    # ---- 本地凭据（JWT，仅承载 userId）----
    jwt_cookie_name: str = "md2ppt_token"
    jwt_secret: str = "REPLACE_ME_WITH_LONG_RANDOM"
    jwt_algorithm: str = "HS256"
    jwt_issuer: str = "md2ppt"
    jwt_ttl_seconds: int = 60 * 60 * 24 - 1200
    jwt_cookie_secure: bool = False

    # ---- 前端跳转 ----
    frontend_home_path: str = "/projects"
    frontend_failed_path: str = "/sso/failed"

    # ---- 日志 ----
    log_level: str = "INFO"


settings = Settings()
