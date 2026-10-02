import os
import tempfile
from datetime import date

import pytest

_tmp = tempfile.mkdtemp(prefix="tp-tests-")
os.environ["FORCE_DEMO"] = "true"
os.environ["DATABASE_URL"] = os.environ.get("TEST_DATABASE_URL") or f"sqlite:///{_tmp}/test.db"
os.environ.pop("OPENAI_API_KEY", None)
os.environ.pop("GOOGLE_MAPS_API_KEY", None)

from travel_planner.agent.research import build_context  # noqa: E402
from travel_planner.agent.tool_client import InProcessTools  # noqa: E402
from travel_planner.db import init_db  # noqa: E402
from travel_planner.schemas import TripRequest  # noqa: E402
from travel_planner.services import rag  # noqa: E402


@pytest.fixture(scope="session", autouse=True)
def _db():
    init_db()
    rag.ensure_seeded()


def make_request(**kw) -> TripRequest:
    base = dict(destination="Jaipur", start_date=date(2026, 11, 10), end_date=date(2026, 11, 13), budget_inr=40000,
                travelers=2, interests=["history", "food", "shopping"], pace="balanced")
    base.update(kw)
    return TripRequest(**base)


@pytest.fixture
def req():
    return make_request()


@pytest.fixture
async def ctx(req):
    return await build_context(req, InProcessTools())
