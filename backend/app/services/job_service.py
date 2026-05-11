from datetime import datetime, timezone
from uuid import uuid4

from fastapi import HTTPException
from sqlmodel import Session, select

from app.models.job import JobRecord


class JobService:
    def __init__(self, session: Session) -> None:
        self.session = session

    def create_job(self, project_id: str) -> JobRecord:
        job = JobRecord(id=f"job_{uuid4().hex[:12]}", project_id=project_id, status="running")
        self.session.add(job)
        self.session.commit()
        self.session.refresh(job)
        return job

    def get_job(self, job_id: str) -> JobRecord:
        job = self.session.get(JobRecord, job_id)
        if not job:
            raise HTTPException(status_code=404, detail="任务不存在")
        return job

    def has_active_job(self, project_id: str) -> bool:
        statement = select(JobRecord).where(JobRecord.project_id == project_id, JobRecord.status == "running")
        return self.session.exec(statement).first() is not None

    def update(self, job: JobRecord, *, stage: str, progress: float, message: str, status: str | None = None, error: str | None = None) -> None:
        job.stage = stage
        job.progress = progress
        job.message = message
        if status:
            job.status = status
        job.error = error
        job.updated_at = datetime.now(timezone.utc)
        print(
            f"[job] id={job.id} project={job.project_id} status={job.status} stage={stage} progress={progress:.2f} message={message} error={error or ''}",
            flush=True,
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
        return job
