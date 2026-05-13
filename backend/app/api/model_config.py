from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from sqlmodel import Session, select

from app.core.auth import get_current_user_id
from app.core.gateway_client import GatewayClient, GatewayError
from app.core.json_repair import loads_json_with_repair
from app.core.security import validate_gateway_base_url
from app.models.db import get_session
from app.models.model_config import ModelConfigRecord
from app.models.schemas import (
    GenerationTestRequest,
    GenerationTestResponse,
    ImageGenerationTestRequest,
    ImageGenerationTestResponse,
    ImageModelConfigStatusResponse,
    ModelConfigStatusResponse,
    ModelInfo,
    ModelListRequest,
    ModelListResponse,
    SaveImageModelConfigRequest,
    SaveModelConfigRequest,
    SaveModelConfigResponse,
)

router = APIRouter(prefix="/api/model-config", tags=["model-config"])


@router.get("")
def get_model_config(
    kind: str = "text",
    session: Session = Depends(get_session),
    user_id: int = Depends(get_current_user_id),
):
    statement = select(ModelConfigRecord).where(
        ModelConfigRecord.kind == kind,
        ModelConfigRecord.user_id == user_id,
    )
    record = session.exec(statement).first()
    if kind == "image":
        if not record or not record.configured:
            return ImageModelConfigStatusResponse(configured=False)
        return ImageModelConfigStatusResponse(
            configured=True,
            base_url=record.base_url,
            selected_model=record.selected_model,
            image_size=record.image_size,
            image_quality=record.image_quality,
        )
    if not record or not record.configured:
        return ModelConfigStatusResponse(configured=False)
    return ModelConfigStatusResponse(
        configured=True,
        base_url=record.base_url,
        selected_model=record.selected_model,
        temperature=record.temperature,
        max_tokens=record.max_tokens,
        generation_endpoint_type=record.generation_endpoint_type,
    )


@router.post("/models", response_model=ModelListResponse)
async def list_models(
    request: ModelListRequest,
    user_id: int = Depends(get_current_user_id),
) -> ModelListResponse:
    try:
        client = GatewayClient(request.base_url, request.api_key)
        models = await client.list_models(request.models_endpoint)
    except (ValueError, GatewayError) as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return ModelListResponse(
        models=[ModelInfo(id=model["id"], owned_by=model.get("owned_by")) for model in models]
    )


@router.post("/generation-test", response_model=GenerationTestResponse)
async def generation_test(
    request: GenerationTestRequest,
    user_id: int = Depends(get_current_user_id),
) -> GenerationTestResponse:
    if request.generation_endpoint_type != "chat_completions":
        raise HTTPException(status_code=400, detail="MVP 只支持 chat_completions 生成端点")
    try:
        client = GatewayClient(request.base_url, request.api_key)
        content = await client.chat_completion_json(
            request.model,
            [
                {"role": "system", "content": "你只输出 JSON。"},
                {"role": "user", "content": "输出 {\"ok\": true} 用于连通性测试。"},
            ],
            max_tokens=64,
        )
        payload = loads_json_with_repair(content)
    except (ValueError, GatewayError) as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    if payload.get("ok") is not True:
        raise HTTPException(status_code=400, detail="模型生成测试未返回预期 JSON")
    return GenerationTestResponse(ok=True, supports_json=True, message="model generation test passed")


@router.post("/image-generation-test", response_model=ImageGenerationTestResponse)
async def image_generation_test(
    request: ImageGenerationTestRequest,
    user_id: int = Depends(get_current_user_id),
) -> ImageGenerationTestResponse:
    try:
        client = GatewayClient(request.base_url, request.api_key)
        await client.image_generation(
            request.model,
            "a white square on white background",
            size=request.image_size,
            quality=request.image_quality,
        )
    except (ValueError, GatewayError) as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return ImageGenerationTestResponse(ok=True, message="image generation test passed")


@router.post("", response_model=SaveModelConfigResponse)
def save_model_config(
    request: SaveModelConfigRequest,
    session: Session = Depends(get_session),
    user_id: int = Depends(get_current_user_id),
) -> SaveModelConfigResponse:
    try:
        base_url = validate_gateway_base_url(request.base_url)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    statement = select(ModelConfigRecord).where(
        ModelConfigRecord.kind == "text",
        ModelConfigRecord.user_id == user_id,
    )
    record = session.exec(statement).first()
    now = datetime.now(timezone.utc)

    if record:
        record.base_url = base_url
        record.api_key_encrypted = request.api_key
        record.selected_model = request.selected_model
        record.temperature = request.temperature
        record.max_tokens = request.max_tokens
        record.generation_endpoint_type = request.generation_endpoint_type
        record.configured = True
        record.updated_at = now
    else:
        record = ModelConfigRecord(
            user_id=user_id,
            kind="text",
            base_url=base_url,
            api_key_encrypted=request.api_key,
            selected_model=request.selected_model,
            temperature=request.temperature,
            max_tokens=request.max_tokens,
            generation_endpoint_type=request.generation_endpoint_type,
            configured=True,
            updated_at=now,
        )

    session.add(record)
    session.commit()
    return SaveModelConfigResponse(config_id=str(record.id), selected_model=request.selected_model, configured=True)


@router.post("/image", response_model=SaveModelConfigResponse)
def save_image_model_config(
    request: SaveImageModelConfigRequest,
    session: Session = Depends(get_session),
    user_id: int = Depends(get_current_user_id),
) -> SaveModelConfigResponse:
    try:
        base_url = validate_gateway_base_url(request.base_url)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    statement = select(ModelConfigRecord).where(
        ModelConfigRecord.kind == "image",
        ModelConfigRecord.user_id == user_id,
    )
    record = session.exec(statement).first()
    now = datetime.now(timezone.utc)

    if record:
        record.base_url = base_url
        record.api_key_encrypted = request.api_key
        record.selected_model = request.selected_model
        record.image_size = request.image_size
        record.image_quality = request.image_quality
        record.configured = True
        record.updated_at = now
    else:
        record = ModelConfigRecord(
            user_id=user_id,
            kind="image",
            base_url=base_url,
            api_key_encrypted=request.api_key,
            selected_model=request.selected_model,
            image_size=request.image_size,
            image_quality=request.image_quality,
            configured=True,
            updated_at=now,
        )

    session.add(record)
    session.commit()
    return SaveModelConfigResponse(config_id=str(record.id), selected_model=request.selected_model, configured=True)
