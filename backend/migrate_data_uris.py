"""一次性把 projectrecord.data_json 里 data: 开头的 image_url 落到磁盘，
然后把字段改写成 /api/images/... 的相对路径。

跑法：
    cd backend
    uv run python migrate_data_uris.py

幂等：已经迁过的项目（slide.image_url 不再以 data: 开头）直接跳过，重跑安全。
注意：脚本会读 APP_STORAGE_DIR 环境变量决定写到哪个 storage_dir，
和后端运行时保持一致即可。
"""
from __future__ import annotations

import json

from sqlmodel import Session, select

from app.core.image_storage import save_data_uri
from app.models.db import engine, init_db
from app.models.project import ProjectRecord


def main() -> None:
    init_db()  # 顺带建好 images/ 目录
    migrated_projects = 0
    migrated_slides = 0
    skipped_invalid = 0

    with Session(engine) as session:
        rows = list(session.exec(select(ProjectRecord)))
        for row in rows:
            try:
                data = json.loads(row.data_json or "{}")
            except json.JSONDecodeError:
                print(f"[skip] {row.id}: data_json 不是合法 JSON")
                skipped_invalid += 1
                continue
            slides = data.get("slides")
            if not isinstance(slides, list):
                continue
            row_changed_count = 0
            for s in slides:
                url = s.get("image_url") if isinstance(s, dict) else None
                if not isinstance(url, str) or not url.startswith("data:"):
                    continue
                slide_no = s.get("slide_no")
                if not isinstance(slide_no, int):
                    # 兜底用列表序号；正常项目都有 slide_no
                    slide_no = slides.index(s) + 1
                saved = save_data_uri(row.id, slide_no, url)
                if not saved:
                    print(f"[warn] {row.id} slide {slide_no}: data URI 解码失败，保留原值")
                    continue
                s["image_url"] = saved
                row_changed_count += 1
                migrated_slides += 1
            if row_changed_count:
                row.data_json = json.dumps(data, ensure_ascii=False)
                session.add(row)
                migrated_projects += 1
                print(f"[ok]   {row.id}: {row_changed_count} 张图落盘")
        session.commit()

    print()
    print(f"Done. projects updated: {migrated_projects}, slides written: {migrated_slides}, skipped(invalid json): {skipped_invalid}")


if __name__ == "__main__":
    main()
