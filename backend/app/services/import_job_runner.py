"""导入项目结构补全的后台任务 worker。

放在 services 层是为了让 projects API（POST /import-prompts）和 generation API
（POST /regenerate-import-structure）都能引用，而不形成 generation ↔ projects 的循环 import。
"""

from fastapi import HTTPException
from loguru import logger
from sqlmodel import Session

from app.models.db import engine
from app.models.project import ProjectRecord
from app.services.generation_service import GenerationService
from app.services.job_service import JobService
from app.services.project_service import ProjectService


def _revert_generation_state_if_stuck(session: Session, project_id: str) -> None:
    """任务失败/取消时把 generation_state 从 'import_structure_generating' 回退到 'prompts_imported'。
    否则下次进入工作台只看到「正在补全结构」标签但其实没有 job 在跑——用户会困惑。

    互斥保护：用户在失败瞬间手点「重新解析」会立刻 spawn 新 job，新 worker 一开始就把
    generation_state 写回 import_structure_generating。先用 has_active_job 复查，
    有新 job 在跑就放弃 revert，让新 worker 自己管理状态。
    """
    record = session.get(ProjectRecord, project_id)
    if not record:
        return
    session.refresh(record)
    if record.generation_state != "import_structure_generating":
        return
    if JobService(session).has_active_job(project_id):
        return
    ProjectService(session).revert_import_structure_state(project_id)


async def run_import_structure_job(job_id: str, project_id: str, user_id: int) -> None:
    """与 _run_generation_job 同型：成功 → completed，499 → cancelled，其他异常 → failed。
    内部 _update_job 总是写 status='running'；必须在外层这里显式收尾，否则前端轮询永远等不到 completed。"""
    with Session(engine) as session:
        job_service = JobService(session)
        job = job_service.get_job(job_id)
        try:
            await GenerationService(session, user_id).run_import_structure_extraction(
                project_id, job_service=job_service, job=job,
            )
            session.refresh(job)
            if job.status != "cancelled":
                job_service.update(job, stage="completed", progress=1.0, message="结构补全完成", status="completed")
        except HTTPException as exc:
            if exc.status_code == 499:
                logger.info("[import-job] cancelled job_id={} project_id={} user_id={}", job_id, project_id, user_id)
                session.refresh(job)
                if job.status != "cancelled":
                    job_service.update(job, stage="cancelled", progress=job.progress, message="任务已取消", status="cancelled")
                _revert_generation_state_if_stuck(session, project_id)
                return
            detail = exc.detail if isinstance(exc.detail, str) else str(exc.detail)
            logger.exception(
                "[import-job] failed job_id={} project_id={} user_id={} stage={} status_code={} detail={}",
                job_id, project_id, user_id, job.stage, exc.status_code, detail,
            )
            job_service.update(job, stage="failed", progress=job.progress, message="结构补全失败", status="failed", error=detail)
            _revert_generation_state_if_stuck(session, project_id)
        except Exception as exc:
            logger.exception(
                "[import-job] failed job_id={} project_id={} user_id={} stage={} error={}",
                job_id, project_id, user_id, job.stage, exc,
            )
            job_service.update(job, stage="failed", progress=job.progress, message="结构补全失败", status="failed", error=str(exc))
            _revert_generation_state_if_stuck(session, project_id)
