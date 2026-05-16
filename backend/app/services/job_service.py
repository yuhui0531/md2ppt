from datetime import datetime, timezone
from uuid import uuid4

from fastapi import HTTPException
from loguru import logger
from sqlmodel import Session, select

from app.models.job import JobRecord
from app.models.time import ensure_utc

JOB_TIMEOUT_SECONDS = 180


class JobService:
    def __init__(self, session: Session) -> None:
        self.session = session

    def create_job(self, project_id: str, kind: str = "generation") -> JobRecord:
        job = JobRecord(id=f"job_{uuid4().hex[:12]}", project_id=project_id, kind=kind, status="running")
        self.session.add(job)
        self.session.commit()
        self.session.refresh(job)
        logger.info("[job] created id={} project={} kind={} status={}", job.id, job.project_id, job.kind, job.status)
        return job

    def get_job(self, job_id: str) -> JobRecord:
        job = self.session.get(JobRecord, job_id)
        if not job:
            raise HTTPException(status_code=404, detail="任务不存在")
        return job

    def has_active_job(self, project_id: str, kind: str | None = None) -> bool:
        return self.get_active_job(project_id, kind=kind) is not None

    def get_active_job(self, project_id: str, kind: str | None = None) -> JobRecord | None:
        """返回项目当前 running 的 Job，没有则 None。
        kind=None 表示不区分类型（同一项目并发写 ProjectData 会冲突，所以
        409 守卫总是按"任意类型"判定）；kind 指定时只在该类型范围内查，
        给前端用来判断"当前页该不该挂进度条"。
        无论是否传 kind，都先做一次跨类型的僵尸清扫——否则一个 generation
        类的死任务可以躲在 kind="image_generation" 查询之外永远占着 running。"""
        self._sweep_timed_out(project_id)
        statement = select(JobRecord).where(JobRecord.project_id == project_id, JobRecord.status == "running")
        if kind is not None:
            statement = statement.where(JobRecord.kind == kind)
        return self.session.exec(statement).first()

    def _sweep_timed_out(self, project_id: str) -> None:
        """把更新时间停留超过 JOB_TIMEOUT_SECONDS 的 running 任务标记为 failed。
        约定：后台任务每个进度 tick 都会刷 updated_at，长时间不刷只可能是
        worker 已经异常退出。不区分 kind。"""
        statement = select(JobRecord).where(JobRecord.project_id == project_id, JobRecord.status == "running")
        now = datetime.now(timezone.utc)
        dirty = False
        # 记下要回退状态的导入项目：worker 进程被 kill / OOM 时 _revert_generation_state_if_stuck
        # 没机会跑，会让项目卡在 import_structure_generating；sweep 路径要兜住这种情况。
        imported_to_revert: list[str] = []
        for job in self.session.exec(statement):
            elapsed = (now - ensure_utc(job.updated_at)).total_seconds()
            if elapsed > JOB_TIMEOUT_SECONDS:
                logger.warning(
                    "[job] timed out id={} project={} kind={} elapsed={:.1f}s timeout={}s",
                    job.id,
                    job.project_id,
                    job.kind,
                    elapsed,
                    JOB_TIMEOUT_SECONDS,
                )
                job.status = "failed"
                job.stage = "timeout"
                job.message = "任务超时，已自动标记为失败"
                job.updated_at = now
                self.session.add(job)
                dirty = True
                if job.kind == "import_structure_generation":
                    imported_to_revert.append(job.project_id)
        if dirty:
            self.session.commit()
        if imported_to_revert:
            # 延迟 import 打破 JobService → ProjectService 的循环（ProjectService 不依赖 JobService）。
            from app.services.project_service import ProjectService
            ps = ProjectService(self.session)
            for pid in imported_to_revert:
                ps.revert_import_structure_state(pid)

    def update(self, job: JobRecord, *, stage: str, progress: float, message: str, status: str | None = None, error: str | None = None) -> None:
        job.stage = stage
        job.progress = progress
        job.message = message
        if status:
            job.status = status
        job.error = error
        job.updated_at = datetime.now(timezone.utc)
        # 运行中任务会高频刷新进度；普通 tick 降到 debug，避免长任务刷满主日志。
        level = "DEBUG" if job.status == "running" else "INFO"
        if job.status in {"failed"} or stage == "timeout":
            level = "WARNING"
        logger.log(
            level,
            "[job] id={} project={} status={} stage={} progress={:.2f} message={} error={}",
            job.id, job.project_id, job.status, stage, progress, message, error or "",
        )
        self.session.add(job)
        self.session.commit()
        self.session.refresh(job)

    def cancel(self, job_id: str) -> JobRecord:
        job = self.get_job(job_id)
        job.cancel_requested = True
        job.status = "cancelled"
        job.stage = "cancelled"
        job.message = "任务已取消"
        job.updated_at = datetime.now(timezone.utc)
        self.session.add(job)
        self.session.commit()
        self.session.refresh(job)
        logger.info("[job] cancelled id={} project={} kind={}", job.id, job.project_id, job.kind)
        return job
