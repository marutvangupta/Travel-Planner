FROM python:3.11-slim AS base
ENV PYTHONUNBUFFERED=1 PIP_NO_CACHE_DIR=1
WORKDIR /app
RUN pip install uv
COPY pyproject.toml ./
COPY src ./src
RUN uv pip install --system ".[postgres,langfuse]"
RUN useradd -m app && chown -R app /app
USER app
EXPOSE 8000
HEALTHCHECK --interval=15s --timeout=3s --retries=5 CMD python -c "import urllib.request;urllib.request.urlopen('http://localhost:8000/health')"
CMD ["uvicorn", "travel_planner.api.main:app", "--host", "0.0.0.0", "--port", "8000"]
