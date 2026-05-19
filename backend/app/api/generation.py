import asyncio

from app.core.auth import get_current_user_id
from app.models.db import engine, get_session
from app.models.job import JobRecord
from app.models.project import ProjectRecord
from app.models.schemas import (
    CheckConsistencyRequest,
    ConsistencyReport,
    CreateSlideRequest,
    CreateSlideResponse,
    GenerateImagesRequest,
    GenerateProjectRequest,
    JobResponse,
    ProjectResponse,
    RegenerateOutlineRequest,
    RegeneratePromptsRequest,
    ReviseInconsistentPromptsRequest,
    UpdateSlidePromptRequest,
)
from app.services.generation_service import GenerationService
from app.services.image_generation_service import ImageGenerationService
from app.services.import_job_runner import run_import_structure_job
from app.services.job_service import JobService
from app.services.project_service import ProjectService
from fastapi import APIRouter, Depends, HTTPException
from loguru import logger
from sqlmodel import Session

router = APIRouter(tags=["generation"])


def _assert_project_owner(session: Session, project_id: str, user_id: int) -> ProjectRecord:
    """校验项目归属并返回 ProjectRecord，避免下游再发一次 session.get 重复查询。"""
    return ProjectService(session)._get_owned_record(project_id, user_id)


def _reject_imported_project(record: ProjectRecord) -> None:
    """对会改写 prompt / 跑原始 Markdown 链路的接口加守卫——导入项目不允许进入。
    前端已经隐藏对应按钮；这里是兜底，防止用户直接发请求。
    调用方必须先用 _assert_project_owner 拿到 record，确保 origin 判定建立在已校验归属之上。"""
    if record.project_origin == "imported_prompts":
        raise HTTPException(status_code=409, detail="导入型项目不支持该操作")


def _assert_job_owner(session: Session, job_id: str, user_id: int) -> JobRecord:
    job = session.get(JobRecord, job_id)
    if not job:
        raise HTTPException(status_code=404, detail="任务不存在")
    record = session.get(ProjectRecord, job.project_id)
    if not record or record.user_id != user_id:
        raise HTTPException(status_code=404, detail="任务不存在")
    return job


@router.post("/api/projects/{project_id}/generate", response_model=JobResponse)
async def generate_project(
    project_id: str,
    request: GenerateProjectRequest,
    session: Session = Depends(get_session),
    user_id: int = Depends(get_current_user_id),
) -> JobResponse:
    record = _assert_project_owner(session, project_id, user_id)
    _reject_imported_project(record)
    job_service = JobService(session)
    if job_service.has_active_job(project_id):
        logger.warning("[generation-job] create rejected project_id={} user_id={} reason=active_job", project_id, user_id)
        raise HTTPException(status_code=409, detail="当前项目已有正在执行的任务")
    job = job_service.create_job(project_id, kind="generation")
    logger.info("[generation-job] created job_id={} project_id={} user_id={} mode={}", job.id, project_id, user_id, request.mode)
    job_service.update(job, stage="queued", progress=0.02, message="生成任务已创建", status="running")
    asyncio.create_task(_run_generation_job(job.id, project_id, request.mode, user_id))
    return JobResponse.from_record(job)


async def _run_generation_job(job_id: str, project_id: str, mode: str, user_id: int) -> None:
    # user_id 由调用方在请求线程内从 JWT 取出后透传进来：
    # 后台任务自己没有 request/cookie，必须显式带上才能找到该用户的模型配置。
    with Session(engine) as session:
        job_service = JobService(session)
        job = job_service.get_job(job_id)
        try:
            await GenerationService(session, user_id).run_generation(project_id, mode=mode, job_service=job_service, job=job)
            # 与 import_job_runner 对齐：内部 _update_job 已多次重写 job 行；这里再读一次 status，
            # 避免 cancelled 路径下覆盖回 completed。
            session.refresh(job)
            if job.status != "cancelled":
                job_service.update(job, stage="consistency_checked", progress=1.0, message="生成完成", status="completed")
        except HTTPException as exc:
            if exc.status_code == 499:
                logger.info("[generation-job] cancelled job_id={} project_id={} user_id={}", job_id, project_id, user_id)
                session.refresh(job)
                if job.status != "cancelled":
                    job_service.update(job, stage="cancelled", progress=job.progress, message="任务已取消", status="cancelled")
                return
            detail = exc.detail if isinstance(exc.detail, str) else str(exc.detail)
            logger.exception(
                "[generation-job] failed job_id={} project_id={} user_id={} stage={} status_code={} detail={}",
                job_id,
                project_id,
                user_id,
                job.stage,
                exc.status_code,
                detail,
            )
            job_service.update(job, stage="failed", progress=job.progress, message="生成失败", status="failed", error=detail)
        except Exception as exc:
            logger.exception(
                "[generation-job] failed job_id={} project_id={} user_id={} stage={} error={}",
                job_id,
                project_id,
                user_id,
                job.stage,
                exc,
            )
            job_service.update(job, stage="failed", progress=job.progress, message="生成失败", status="failed", error=str(exc))


@router.get("/api/projects/{project_id}/active-job", response_model=JobResponse | None)
def get_active_job_for_project(
    project_id: str,
    session: Session = Depends(get_session),
    user_id: int = Depends(get_current_user_id),
) -> JobResponse | None:
    """工作台进入时用这个轻量端点探测是否已有任务在跑：
    有就让前端直接挂上去显示进度条 + 轮询，没有就返回 null。
    顺带由 JobService 把僵尸任务标记 failed，避免前端永远卡进度。"""
    _assert_project_owner(session, project_id, user_id)
    job = JobService(session).get_active_job(project_id)
    if not job:
        return None
    return JobResponse.from_record(job)


@router.get("/api/jobs/{job_id}", response_model=JobResponse)
def get_job(
    job_id: str,
    session: Session = Depends(get_session),
    user_id: int = Depends(get_current_user_id),
) -> JobResponse:
    job = _assert_job_owner(session, job_id, user_id)
    return JobResponse.from_record(job)


@router.post("/api/jobs/{job_id}/cancel", response_model=JobResponse)
def cancel_job(
    job_id: str,
    session: Session = Depends(get_session),
    user_id: int = Depends(get_current_user_id),
) -> JobResponse:
    _assert_job_owner(session, job_id, user_id)
    job = JobService(session).cancel(job_id)
    return JobResponse.from_record(job)


@router.post("/api/projects/{project_id}/regenerate-outline", response_model=ProjectResponse)
async def regenerate_outline(
    project_id: str,
    request: RegenerateOutlineRequest,
    session: Session = Depends(get_session),
    user_id: int = Depends(get_current_user_id),
) -> ProjectResponse:
    record = _assert_project_owner(session, project_id, user_id)
    _reject_imported_project(record)
    data = GenerationService(session, user_id).project_service.get_project_data_internal(project_id)
    data.generation_options.slide_count_mode = request.slide_count_mode
    data.generation_options.requested_slide_count = request.requested_slide_count
    data.generation_options.requested_slide_range = request.requested_slide_range
    service = GenerationService(session, user_id)
    updated = await service.regenerate_outline(project_id, data.generation_options)
    return ProjectResponse(project=updated)


@router.post("/api/projects/{project_id}/regenerate-prompts", response_model=ProjectResponse)
async def regenerate_prompts(
    project_id: str,
    request: RegeneratePromptsRequest,
    session: Session = Depends(get_session),
    user_id: int = Depends(get_current_user_id),
) -> ProjectResponse:
    record = _assert_project_owner(session, project_id, user_id)
    _reject_imported_project(record)
    updated = await GenerationService(session, user_id).regenerate_prompts(project_id, request.slide_numbers)
    return ProjectResponse(project=updated)


@router.post("/api/projects/{project_id}/check-consistency", response_model=ProjectResponse)
async def check_consistency(
    project_id: str,
    request: CheckConsistencyRequest,
    session: Session = Depends(get_session),
    user_id: int = Depends(get_current_user_id),
) -> ProjectResponse:
    _assert_project_owner(session, project_id, user_id)
    # 一致性检查会写整份 ProjectData（含 consistency_report 和 slides[i].style_issues 等），
    # 与导入 worker 的阶段性落盘会相互覆盖。前端在 jobRunning 时禁用了按钮，这里是兜底。
    _assert_no_active_job(session, project_id)
    updated = await GenerationService(session, user_id).check_consistency_for_project(project_id, request.threshold)
    return ProjectResponse(project=updated)


@router.post("/api/projects/{project_id}/revise-inconsistent-prompts", response_model=JobResponse)
async def revise_inconsistent_prompts(
    project_id: str,
    request: ReviseInconsistentPromptsRequest,
    session: Session = Depends(get_session),
    user_id: int = Depends(get_current_user_id),
) -> JobResponse:
    _assert_project_owner(session, project_id, user_id)
    job_service = JobService(session)
    # 修正不一致会重写 slides[i].prompt，与并发任务必然冲突。
    if job_service.has_active_job(project_id):
        logger.warning(
            "[revise-job] create rejected project_id={} user_id={} reason=active_job",
            project_id, user_id,
        )
        raise HTTPException(status_code=409, detail="当前项目已有正在执行的任务")
    job = job_service.create_job(project_id, kind="revise_inconsistent")
    logger.info(
        "[revise-job] created job_id={} project_id={} user_id={} threshold={} max_rounds={} slide_numbers={}",
        job.id, project_id, user_id, request.threshold, request.max_rounds, request.slide_numbers,
    )
    job_service.update(job, stage="queued", progress=0.0, message="修正任务已创建", status="running")
    asyncio.create_task(_run_revise_job(
        job.id, project_id, request.threshold, request.max_rounds, request.slide_numbers, user_id,
    ))
    return JobResponse.from_record(job)


async def _run_revise_job(
    job_id: str,
    project_id: str,
    threshold: float,
    max_rounds: int,
    slide_numbers: list[int] | None,
    user_id: int,
) -> None:
    with Session(engine) as session:
        job_service = JobService(session)
        job = job_service.get_job(job_id)
        try:
            await GenerationService(session, user_id).revise_inconsistent_prompts(
                project_id, threshold, max_rounds, slide_numbers,
                job_service=job_service, job=job,
            )
            # 与生图 / 大纲生成 job 对齐：内部 _update_job 已多次重写 job 行；这里再读一次
            # status，避免 cancelled 路径下覆盖回 completed。短路 return 时 service 已
            # emit "no_inconsistent" 阶段，message 准确反映「无需修正」；不要再覆盖。
            # 用 endswith 而非 ==：service 可能加 stage_prefix（preflight 路径），
            # 这条 worker 当前不走 preflight，但用 endswith 让契约更稳。
            session.refresh(job)
            stage_is_no_inconsistent = (job.stage or "").endswith("no_inconsistent")
            if job.status != "cancelled" and not stage_is_no_inconsistent:
                job_service.update(job, stage="completed", progress=1.0,
                                   message="修正完成", status="completed")
            elif stage_is_no_inconsistent:
                # 让前端轮询拿到「completed」状态结束轮询，但保留 service 写入的语义文案。
                job_service.update(job, stage=job.stage, progress=1.0,
                                   message=job.message, status="completed")
        except HTTPException as exc:
            if exc.status_code == 499:
                logger.info("[revise-job] cancelled job_id={} project_id={} user_id={}", job_id, project_id, user_id)
                session.refresh(job)
                if job.status != "cancelled":
                    job_service.update(job, stage="cancelled", progress=job.progress,
                                       message="任务已取消", status="cancelled")
                return
            detail = exc.detail if isinstance(exc.detail, str) else str(exc.detail)
            logger.exception(
                "[revise-job] failed job_id={} project_id={} user_id={} stage={} status_code={} detail={}",
                job_id, project_id, user_id, job.stage, exc.status_code, detail,
            )
            job_service.update(job, stage="failed", progress=job.progress,
                               message="修正失败", status="failed", error=detail)
        except Exception as exc:
            logger.exception(
                "[revise-job] failed job_id={} project_id={} user_id={} stage={} error={}",
                job_id, project_id, user_id, job.stage, exc,
            )
            job_service.update(job, stage="failed", progress=job.progress,
                               message="修正失败", status="failed", error=str(exc))


@router.post("/api/projects/{project_id}/regenerate-import-structure", response_model=JobResponse)
async def regenerate_import_structure(
    project_id: str,
    session: Session = Depends(get_session),
    user_id: int = Depends(get_current_user_id),
) -> JobResponse:
    """重新跑结构补全：只更新结构化字段，不改写 prompt。
    复用 /import-prompts 的后台任务路径，前端拿到 job_id 后挂进度条等结束。"""
    record = _assert_project_owner(session, project_id, user_id)
    if record.project_origin != "imported_prompts":
        raise HTTPException(status_code=409, detail="仅导入型项目支持重新解析页面结构")
    job_service = JobService(session)
    if job_service.has_active_job(project_id):
        raise HTTPException(status_code=409, detail="当前项目已有正在执行的任务")
    job = job_service.create_job(project_id, kind="import_structure_generation")
    job_service.update(job, stage="queued", progress=0.02, message="结构补全任务已创建", status="running")
    logger.info(
        "[import-job] re-created job_id={} project_id={} user_id={}",
        job.id, project_id, user_id,
    )
    asyncio.create_task(run_import_structure_job(job.id, project_id, user_id))
    return JobResponse.from_record(job)


def _assert_no_active_job(session: Session, project_id: str) -> None:
    if JobService(session).has_active_job(project_id):
        raise HTTPException(status_code=409, detail="当前项目已有正在执行的任务")


@router.post("/api/projects/{project_id}/slides", response_model=CreateSlideResponse)
def create_slide(
    project_id: str,
    request: CreateSlideRequest,
    session: Session = Depends(get_session),
    user_id: int = Depends(get_current_user_id),
) -> CreateSlideResponse:
    _assert_project_owner(session, project_id, user_id)
    _assert_no_active_job(session, project_id)
    updated, new_slide_id = ProjectService(session).insert_slide(project_id, request.after_slide_id, request.prompt)
    return CreateSlideResponse(project=updated, new_slide_id=new_slide_id)


@router.patch("/api/projects/{project_id}/slides/{slide_id}", response_model=ProjectResponse)
def update_slide_prompt(
    project_id: str,
    slide_id: str,
    request: UpdateSlidePromptRequest,
    session: Session = Depends(get_session),
    user_id: int = Depends(get_current_user_id),
) -> ProjectResponse:
    _assert_project_owner(session, project_id, user_id)
    # 与所有写 ProjectData 的端点对齐：任意 job 在跑就拒绝。
    # 早先放过 import_structure_generation 是想兑现 PRD「任务中可编辑 prompt」承诺，
    # 但 update_slide_prompt 是"读整份→改一项→整包写"，会和 worker 的整包写发生
    # lost update（用户最后一次保存可能把 worker 刚抽出的 page_type/core_message 覆盖掉）。
    # 在没做细粒度更新前，这条承诺必须撤回。
    _assert_no_active_job(session, project_id)
    updated = ProjectService(session).update_slide_prompt(project_id, slide_id, request.prompt)
    return ProjectResponse(project=updated)


@router.delete("/api/projects/{project_id}/slides/{slide_id}", response_model=ProjectResponse)
def delete_slide(
    project_id: str,
    slide_id: str,
    session: Session = Depends(get_session),
    user_id: int = Depends(get_current_user_id),
) -> ProjectResponse:
    _assert_project_owner(session, project_id, user_id)
    _assert_no_active_job(session, project_id)
    updated = ProjectService(session).delete_slide(project_id, slide_id)
    return ProjectResponse(project=updated)


@router.post("/api/projects/{project_id}/generate-images", response_model=JobResponse)
async def generate_images(
    project_id: str,
    request: GenerateImagesRequest,
    session: Session = Depends(get_session),
    user_id: int = Depends(get_current_user_id),
) -> JobResponse:
    _assert_project_owner(session, project_id, user_id)
    ImageGenerationService(session, user_id).get_image_config()
    job_service = JobService(session)
    if job_service.has_active_job(project_id):
        logger.warning("[image-job] create rejected project_id={} user_id={} reason=active_job", project_id, user_id)
        raise HTTPException(status_code=409, detail="当前项目已有正在执行的任务")
    job = job_service.create_job(project_id, kind="image_generation")
    logger.info(
        "[image-job] created job_id={} project_id={} user_id={} slide_numbers={} extra_prompts_count={}",
        job.id,
        project_id,
        user_id,
        request.slide_numbers,
        len(request.extra_prompts or {}),
    )
    job_service.update(job, stage="queued", progress=0.0, message="批量生图任务已创建", status="running")
    asyncio.create_task(
        _run_image_generation_job(
            job.id,
            project_id,
            request.slide_numbers,
            request.extra_prompts,
            user_id,
        )
    )
    return JobResponse.from_record(job)


async def _run_image_generation_job(
    job_id: str,
    project_id: str,
    slide_numbers: list[int] | None,
    extra_prompts: dict[int, str] | None = None,
    user_id: int = -1,
) -> None:
    # 同 _run_generation_job：user_id 用于在后台任务里定位调用者的生图模型配置。
    # 默认 -1 仅是签名兜底；正常路径下 API 入口一定会传真实 user_id 进来。
    with Session(engine) as session:
        job_service = JobService(session)
        job = job_service.get_job(job_id)
        try:
            await _ensure_prompts_checked_before_image_generation(session, user_id, project_id, job_service, job)
            await ImageGenerationService(session, user_id).run_batch_generation(
                project_id,
                slide_numbers,
                job_service,
                job,
                extra_prompts=extra_prompts,
            )
        except Exception as exc:
            logger.exception(
                "[image-job] failed job_id={} project_id={} user_id={} stage={} error={}",
                job_id,
                project_id,
                user_id,
                job.stage,
                exc,
            )
            job_service.update(job, stage="failed", progress=job.progress, message=str(exc), status="failed", error=str(exc))


async def _ensure_prompts_checked_before_image_generation(
    session: Session,
    user_id: int,
    project_id: str,
    job_service: JobService,
    job: JobRecord,
) -> None:
    service = GenerationService(session, user_id)
    data = service.project_service.get_project_data_internal(project_id)
    threshold = data.generation_options.consistency_threshold

    report = data.consistency_report
    if report is None or report.threshold != threshold:
        job_service.update(job, stage="consistency_checking", progress=0.0, message="生图前检查 prompt 一致性", status="running")
        data = await service.check_consistency_for_project(project_id, threshold)
        report = data.consistency_report

    if not _has_inconsistent_prompts(report, threshold):
        return

    job_service.update(job, stage="revising_prompts", progress=0.0, message="生图前自动修正不一致 prompt", status="running")
    data = await service.revise_inconsistent_prompts(
        project_id, threshold,
        job_service=job_service, job=job,
        stage_prefix="preflight_",
        # 生图 job 整条进度条的前 20% 留给 preflight，后续 image_generation 从 0
        # 重新计但前端轮询能稳定推进——避免 100% 跳回 0% 的视觉断层。
        progress_max=0.2,
    )
    if _has_inconsistent_prompts(data.consistency_report, threshold):
        logger.warning(
            "[image-job] prompts still inconsistent after preflight revision job_id={} project_id={} user_id={} threshold={}",
            job.id,
            project_id,
            user_id,
            threshold,
        )


def _has_inconsistent_prompts(report: ConsistencyReport | None, threshold: float) -> bool:
    return any(
        slide.revision_needed or slide.score < threshold
        for slide in (report.slides if report else [])
    )
