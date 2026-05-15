import asyncio
import sys
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

from pydantic import ValidationError

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from app.config import Settings  # noqa: E402
from app.models.schemas import (  # noqa: E402
    ConsistencyReport,
    ConsistencySlideReport,
    DeckBrief,
    GenerationOptions,
    ParsedSection,
    ProjectData,
    Slide,
    SlideCountPlan,
    SourceSlideCountConstraint,
    StyleGuide,
)
from app.services.generation_service import GenerationService  # noqa: E402
from app.services.image_generation_service import ImageGenerationService  # noqa: E402


class FakeAsyncClient:
    async def __aenter__(self):
        return self

    async def __aexit__(self, exc_type, exc, tb):
        return False


class GenerationServiceSpeedupTests(unittest.IsolatedAsyncioTestCase):
    async def test_run_generation_parsed_stage_runs_brief_and_constraint_concurrently_and_saves_once(self) -> None:
        data = ProjectData(
            project_id="proj_1",
            source={"filename": "demo.md", "language": "zh-CN"},
            generation_options=GenerationOptions(),
            parsed_sections=[ParsedSection(id="s1", heading="H1", level=1, content="body", order=1)],
            generation_state="parsed",
        )
        service = GenerationService(session=object(), user_id=1)
        saved_states: list[str] = []
        timeline: list[str] = []

        service.project_service = SimpleNamespace(
            get_project_data_internal=lambda _project_id: data,
            save_project_data=lambda current: saved_states.append(current.generation_state),
        )
        service._ensure_not_cancelled = lambda *_args, **_kwargs: None
        service._update_job = lambda *_args, **_kwargs: None

        async def fake_generate_brief(_data, async_client=None):
            self.assertIsNotNone(async_client)
            timeline.append("brief-start")
            await asyncio.sleep(0)
            timeline.append("brief-end")
            return DeckBrief(topic="brief")

        async def fake_extract(_data, async_client=None):
            self.assertIsNotNone(async_client)
            timeline.append("constraint-start")
            await asyncio.sleep(0)
            timeline.append("constraint-end")
            return SourceSlideCountConstraint(kind="none")

        async def fake_recommend(_data, async_client=None):
            self.assertIsNotNone(async_client)
            return SlideCountPlan(accepted_slide_count=1, recommended_slide_count=1)

        async def fake_outline(_data, job_service=None, job=None, async_client=None):
            self.assertIsNotNone(async_client)
            return [Slide(slide_no=1, title="A", page_type="cover")]

        async def fake_style_guide(_data, async_client=None):
            self.assertIsNotNone(async_client)
            return StyleGuide(visual_style="clean")

        async def fake_slide_prompts(_data, slide_numbers=None, job_service=None, job=None, async_client=None):
            self.assertIsNotNone(async_client)
            return [Slide(slide_no=1, title="A", page_type="cover", prompt="prompt")]

        async def fake_consistency(_data, threshold=None, async_client=None):
            self.assertIsNotNone(async_client)
            return ConsistencyReport(overall_score=1.0, threshold=0.85, slides=[])

        service.generate_brief = fake_generate_brief
        service.extract_source_slide_count_constraint = fake_extract
        service.recommend_slide_count = fake_recommend
        service.generate_outline = fake_outline
        service.generate_style_guide = fake_style_guide
        service.generate_slide_prompts = fake_slide_prompts
        service.check_consistency = fake_consistency

        result = await service.run_generation("proj_1")

        self.assertIs(result, data)
        self.assertEqual(data.generation_state, "consistency_checked")
        self.assertEqual(timeline[:2], ["brief-start", "constraint-start"])
        self.assertIn("brief-end", timeline)
        self.assertIn("constraint-end", timeline)
        self.assertEqual(saved_states[0], "brief_generated")
        self.assertEqual(saved_states.count("brief_generated"), 1)

    async def test_run_generation_parsed_stage_cancels_sibling_task_on_failure(self) -> None:
        data = ProjectData(
            project_id="proj_1",
            source={"filename": "demo.md", "language": "zh-CN"},
            generation_options=GenerationOptions(),
            parsed_sections=[ParsedSection(id="s1", heading="H1", level=1, content="body", order=1)],
            generation_state="parsed",
        )
        service = GenerationService(session=object(), user_id=1)
        saved_states: list[str] = []
        timeline: list[str] = []

        service.project_service = SimpleNamespace(
            get_project_data_internal=lambda _project_id: data,
            save_project_data=lambda current: saved_states.append(current.generation_state),
        )
        service._ensure_not_cancelled = lambda *_args, **_kwargs: None
        service._update_job = lambda *_args, **_kwargs: None

        async def fake_generate_brief(_data, async_client=None):
            self.assertIsNotNone(async_client)
            timeline.append("brief-start")
            await asyncio.sleep(0)
            timeline.append("brief-failed")
            raise RuntimeError("brief failed")

        async def fake_extract(_data, async_client=None):
            self.assertIsNotNone(async_client)
            timeline.append("constraint-start")
            try:
                await asyncio.sleep(60)
            except asyncio.CancelledError:
                timeline.append("constraint-cancelled")
                raise
            timeline.append("constraint-leaked")
            return SourceSlideCountConstraint(kind="none")

        service.generate_brief = fake_generate_brief
        service.extract_source_slide_count_constraint = fake_extract

        with self.assertRaisesRegex(RuntimeError, "brief failed"):
            await service.run_generation("proj_1")

        self.assertEqual(saved_states, [])
        self.assertIsNone(data.deck_brief)
        self.assertIsNone(data.source_slide_count_constraint)
        self.assertIn("constraint-cancelled", timeline)
        self.assertNotIn("constraint-leaked", timeline)

    def test_effective_max_tokens_uses_stage_caps(self) -> None:
        self.assertEqual(GenerationService._effective_max_tokens("内容理解摘要", 5000), 3072)
        self.assertEqual(GenerationService._effective_max_tokens("源材料页数约束抽取", 5000), 512)
        self.assertEqual(GenerationService._effective_max_tokens("页数推荐", 5000), 1024)
        self.assertEqual(GenerationService._effective_max_tokens("视觉规范", 5000), 2048)
        self.assertEqual(GenerationService._effective_max_tokens("风格一致性检查", 5000), 4096)
        self.assertEqual(GenerationService._effective_max_tokens("大纲生成", 5000), 5000)
        self.assertEqual(GenerationService._effective_max_tokens("逐页 prompt 生成", 5000), 5000)
        self.assertEqual(GenerationService._effective_max_tokens("内容理解摘要", None), 3072)
        self.assertEqual(GenerationService._effective_max_tokens("大纲生成", None), 81920)

    async def test_regenerate_outline_reuses_one_shared_async_client(self) -> None:
        data = ProjectData(
            project_id="proj_outline",
            source={"filename": "demo.md", "language": "zh-CN"},
            generation_options=GenerationOptions(),
            parsed_sections=[ParsedSection(id="s1", heading="H1", level=1, content="body", order=1)],
            generation_state="parsed",
        )
        service = GenerationService(session=object(), user_id=1)
        saved_states: list[str] = []
        seen_clients: list[object] = []

        service.project_service = SimpleNamespace(
            get_project_data_internal=lambda _project_id: data,
            save_project_data=lambda current: saved_states.append(current.generation_state),
        )

        async def fake_generate_brief(_data, async_client=None):
            seen_clients.append(async_client)
            return DeckBrief(topic="brief")

        async def fake_extract(_data, async_client=None):
            seen_clients.append(async_client)
            return SourceSlideCountConstraint(kind="none")

        async def fake_recommend(_data, async_client=None):
            seen_clients.append(async_client)
            return SlideCountPlan(accepted_slide_count=1, recommended_slide_count=1)

        async def fake_outline(_data, job_service=None, job=None, async_client=None):
            seen_clients.append(async_client)
            return [Slide(slide_no=1, title="A", page_type="cover")]

        service.generate_brief = fake_generate_brief
        service.extract_source_slide_count_constraint = fake_extract
        service.recommend_slide_count = fake_recommend
        service.generate_outline = fake_outline

        with patch("app.services.generation_service.httpx.AsyncClient", return_value=FakeAsyncClient()):
            result = await service.regenerate_outline("proj_outline", GenerationOptions(slide_count_mode="auto"))

        self.assertIs(result, data)
        self.assertEqual(data.generation_state, "outline_generated")
        self.assertEqual(saved_states, ["outline_generated"])
        self.assertTrue(seen_clients)
        self.assertTrue(all(client is not None for client in seen_clients))
        self.assertEqual(len({id(client) for client in seen_clients}), 1)

    async def test_regenerate_prompts_reuses_one_shared_async_client(self) -> None:
        data = ProjectData(
            project_id="proj_prompts",
            source={"filename": "demo.md", "language": "zh-CN"},
            generation_options=GenerationOptions(),
            style_guide=StyleGuide(visual_style="clean"),
            slides=[Slide(slide_no=1, title="A", page_type="cover", prompt="old")],
            generation_state="style_guide_generated",
        )
        service = GenerationService(session=object(), user_id=1)
        saved_states: list[str] = []
        seen_clients: list[object] = []

        service.project_service = SimpleNamespace(
            get_project_data_internal=lambda _project_id: data,
            save_project_data=lambda current: saved_states.append(current.generation_state),
        )

        async def fake_generate_slide_prompts(_data, slide_numbers=None, job_service=None, job=None, async_client=None):
            seen_clients.append(async_client)
            return [Slide(slide_no=1, title="A", page_type="cover", prompt="new")]

        service.generate_slide_prompts = fake_generate_slide_prompts

        with patch("app.services.generation_service.httpx.AsyncClient", return_value=FakeAsyncClient()):
            result = await service.regenerate_prompts("proj_prompts", [1])

        self.assertIs(result, data)
        self.assertEqual(data.generation_state, "prompts_generated")
        self.assertEqual(saved_states, ["prompts_generated"])
        self.assertEqual(data.slides[0].prompt, "new")
        self.assertTrue(all(client is not None for client in seen_clients))
        self.assertEqual(len({id(client) for client in seen_clients}), 1)

    async def test_check_consistency_for_project_reuses_one_shared_async_client(self) -> None:
        data = ProjectData(
            project_id="proj_consistency",
            source={"filename": "demo.md", "language": "zh-CN"},
            generation_options=GenerationOptions(),
            style_guide=StyleGuide(visual_style="clean"),
            slides=[Slide(slide_no=1, title="A", page_type="cover", prompt="p")],
            generation_state="prompts_generated",
        )
        service = GenerationService(session=object(), user_id=1)
        saved_states: list[str] = []
        seen_clients: list[object] = []

        service.project_service = SimpleNamespace(
            get_project_data_internal=lambda _project_id: data,
            save_project_data=lambda current: saved_states.append(current.generation_state),
        )

        async def fake_check_consistency(_data, threshold=None, async_client=None):
            seen_clients.append(async_client)
            return ConsistencyReport(overall_score=0.9, threshold=threshold or 0.85, slides=[])

        service.check_consistency = fake_check_consistency

        with patch("app.services.generation_service.httpx.AsyncClient", return_value=FakeAsyncClient()):
            result = await service.check_consistency_for_project("proj_consistency", 0.9)

        self.assertIs(result, data)
        self.assertEqual(data.generation_state, "consistency_checked")
        self.assertEqual(saved_states, ["consistency_checked"])
        self.assertTrue(all(client is not None for client in seen_clients))
        self.assertEqual(len({id(client) for client in seen_clients}), 1)

    async def test_revise_inconsistent_prompts_reuses_one_shared_async_client(self) -> None:
        data = ProjectData(
            project_id="proj_revise",
            source={"filename": "demo.md", "language": "zh-CN"},
            generation_options=GenerationOptions(),
            style_guide=StyleGuide(visual_style="clean"),
            slides=[Slide(slide_no=1, title="A", page_type="cover", prompt="old")],
            consistency_report=ConsistencyReport(
                overall_score=0.5,
                threshold=0.85,
                slides=[ConsistencySlideReport(slide_no=1, score=0.5, revision_needed=True)],
            ),
            generation_state="consistency_checked",
        )
        service = GenerationService(session=object(), user_id=1)
        saved_states: list[str] = []
        consistency_clients: list[object] = []
        call_json_clients: list[object] = []

        service.project_service = SimpleNamespace(
            get_project_data_internal=lambda _project_id: data,
            save_project_data=lambda current: saved_states.append(current.generation_state),
        )

        async def fake_check_consistency(_data, threshold=None, async_client=None):
            consistency_clients.append(async_client)
            return ConsistencyReport(overall_score=0.9, threshold=threshold or 0.85, slides=[])

        async def fake_call_json(stage, task_prompt, payload, on_partial=None, async_client=None):
            call_json_clients.append(async_client)
            return {"slides": [{"slide_no": 1, "title": "A", "page_type": "cover", "prompt": "revised"}]}

        service.check_consistency = fake_check_consistency
        service._call_json = fake_call_json

        with patch("app.services.generation_service.httpx.AsyncClient", return_value=FakeAsyncClient()):
            result = await service.revise_inconsistent_prompts("proj_revise", 0.85)

        self.assertIs(result, data)
        self.assertEqual(data.generation_state, "revised")
        self.assertEqual(saved_states, ["revised"])
        self.assertEqual(data.slides[0].prompt, "revised")
        self.assertEqual(len(call_json_clients), 1)
        self.assertEqual(len(consistency_clients), 1)
        self.assertIsNotNone(call_json_clients[0])
        self.assertIs(call_json_clients[0], consistency_clients[0])

    def test_speedup_settings_reject_invalid_values(self) -> None:
        invalid_settings = [
            {"image_generation_concurrency": 0},
            {"image_progress_flush_interval_seconds": -0.1},
            {"text_cap_brief": 0},
            {"text_cap_source_slide_constraint": 0},
            {"text_cap_slide_count": 0},
            {"text_cap_style_guide": 0},
            {"text_cap_consistency": 0},
        ]
        for kwargs in invalid_settings:
            with self.subTest(kwargs=kwargs):
                with self.assertRaises(ValidationError):
                    Settings(_env_file=None, **kwargs)


class ImageGenerationServiceSpeedupTests(unittest.IsolatedAsyncioTestCase):
    async def test_batch_generation_throttles_flush_and_forces_final_persist(self) -> None:
        slides = [
            Slide(slide_no=1, title="A", page_type="cover", prompt="p1"),
            Slide(slide_no=2, title="B", page_type="content", prompt="p2"),
        ]
        data = ProjectData(
            project_id="proj_2",
            source={"filename": "demo.md", "language": "zh-CN"},
            generation_options=GenerationOptions(),
            slides=slides,
            generation_state="prompts_generated",
        )
        service = ImageGenerationService(session=object(), user_id=1)
        service.project_service = SimpleNamespace(
            get_project_data_internal=lambda _project_id: data,
            save_project_data=lambda current: save_calls.append([slide.image_url for slide in current.slides]),
        )
        service.get_image_config = lambda: SimpleNamespace(
            base_url="https://example.com",
            api_key_encrypted="token",
            selected_model="image-model",
            image_size="2048x1152",
            image_quality="hd",
        )
        save_calls: list[list[str | None]] = []
        job_updates: list[tuple[str, float, str, str]] = []
        job_service = SimpleNamespace(
            update=lambda _job, *, stage, progress, message, status, error=None: job_updates.append((stage, progress, message, status))
        )
        job = SimpleNamespace(id="job_1")

        async def fake_image_generation(*, model, prompt, size, quality):
            await asyncio.sleep(0)
            return f"data-for-{prompt}"

        with (
            patch("app.services.image_generation_service.httpx.AsyncClient", return_value=FakeAsyncClient()),
            patch("app.services.image_generation_service.GatewayClient") as gateway_cls,
            patch("app.services.image_generation_service.save_data_uri", side_effect=lambda project_id, slide_no, image_url: f"saved-{slide_no}"),
            patch("app.services.image_generation_service.settings.image_progress_flush_interval_seconds", 10**20),
            patch("app.services.image_generation_service.settings.image_generation_concurrency", 2),
        ):
            gateway_cls.return_value.image_generation.side_effect = fake_image_generation
            await service.run_batch_generation("proj_2", None, job_service, job)

        self.assertEqual(save_calls, [["saved-1", "saved-2"]])
        self.assertEqual(job_updates[-1], ("completed", 1.0, "全部 2 张生图完成", "completed"))
        self.assertEqual(data.slides[0].image_url, "saved-1")
        self.assertEqual(data.slides[1].image_url, "saved-2")


if __name__ == "__main__":
    unittest.main()
