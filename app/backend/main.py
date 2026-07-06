from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
import logging
import asyncio
import time
from collections import defaultdict, deque

from app.backend.routes import api_router
from app.backend.database.connection import engine
from app.backend.database.models import Base
from app.backend.services.ollama_service import ollama_service

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = FastAPI(title="AI Hedge Fund API", description="Backend API for AI Hedge Fund", version="0.1.0")

# Initialize database tables (this is safe to run multiple times)
Base.metadata.create_all(bind=engine)

# Configure CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],  # Frontend URLs
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["X-Total-Count"],
)

# ── 인바운드 rate limit (외부 의존성 없음) ─────────────────────────────────
# /hedge-api/ 프록시 뒤에서 무인증으로 공개되는 고비용 엔드포인트의
# 비용 폭주(LLM 호출·외부 데이터 쿼터 소진)를 막는 최소 방어선.
# 단일 uvicorn 프로세스 전제의 IP별 슬라이딩 윈도우 카운터.
RATE_LIMITS: dict[str, tuple[int, int]] = {
    # path: (max_calls, window_seconds)
    "/hedge-fund/run": (4, 60),
    "/hedge-fund/backtest": (2, 60),
    "/hedge-fund/fetch-metrics": (12, 60),
}
_rate_buckets: dict[tuple[str, str], deque] = defaultdict(deque)
_RATE_BUCKETS_MAX = 2000  # 다수 IP로 인한 메모리 팽창 상한


def _client_ip(request: Request) -> str:
    # 백엔드는 127.0.0.1 바인딩이라 모든 요청이 Apache 프록시를 거친다.
    # Apache는 X-Forwarded-For에 실제 클라이언트 IP를 append하므로
    # 위조 방지를 위해 (첫 값이 아닌) 마지막 값을 신뢰한다.
    forwarded = request.headers.get("x-forwarded-for")
    if forwarded:
        return forwarded.split(",")[-1].strip()
    return request.client.host if request.client else "unknown"


@app.middleware("http")
async def rate_limit_middleware(request: Request, call_next):
    limit_conf = RATE_LIMITS.get(request.url.path)
    if limit_conf:
        max_calls, window = limit_conf
        now = time.monotonic()
        key = (request.url.path, _client_ip(request))
        bucket = _rate_buckets[key]
        while bucket and now - bucket[0] > window:
            bucket.popleft()
        if len(bucket) >= max_calls:
            retry_after = max(1, int(window - (now - bucket[0])) + 1)
            return JSONResponse(
                status_code=429,
                content={"detail": "요청이 너무 잦습니다. 잠시 후 다시 시도해주세요."},
                headers={"Retry-After": str(retry_after)},
            )
        bucket.append(now)
        if len(_rate_buckets) > _RATE_BUCKETS_MAX:
            stale = [k for k, b in _rate_buckets.items() if not b or now - b[-1] > window]
            for k in stale[: max(0, len(_rate_buckets) - _RATE_BUCKETS_MAX)]:
                _rate_buckets.pop(k, None)
    return await call_next(request)


# Include all routes
app.include_router(api_router)

@app.on_event("startup")
async def startup_event():
    """Startup event to check Ollama availability."""
    try:
        logger.info("Checking Ollama availability...")
        status = await ollama_service.check_ollama_status()
        
        if status["installed"]:
            if status["running"]:
                logger.info(f"✓ Ollama is installed and running at {status['server_url']}")
                if status["available_models"]:
                    logger.info(f"✓ Available models: {', '.join(status['available_models'])}")
                else:
                    logger.info("ℹ No models are currently downloaded")
            else:
                logger.info("ℹ Ollama is installed but not running")
                logger.info("ℹ You can start it from the Settings page or manually with 'ollama serve'")
        else:
            logger.info("ℹ Ollama is not installed. Install it to use local models.")
            logger.info("ℹ Visit https://ollama.com to download and install Ollama")
            
    except Exception as e:
        logger.warning(f"Could not check Ollama status: {e}")
        logger.info("ℹ Ollama integration is available if you install it later")
