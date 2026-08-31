from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import settings
from app.database import init_db
from app.routers import chat, dashboard, errors, journal, livekit, practice, reader, settings as settings_router, tenses, vocab


@asynccontextmanager
async def lifespan(app: FastAPI):
    await init_db()
    yield


app = FastAPI(title="Dil Programı API", version="0.1.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origin_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(chat.router, prefix="/api")
app.include_router(dashboard.router, prefix="/api")
app.include_router(vocab.router, prefix="/api")
app.include_router(tenses.router, prefix="/api")
app.include_router(errors.router, prefix="/api")
app.include_router(reader.router, prefix="/api")
app.include_router(journal.router, prefix="/api")
app.include_router(practice.router, prefix="/api")
app.include_router(settings_router.router, prefix="/api")
app.include_router(livekit.router, prefix="/api")


@app.get("/")
async def root():
    return {"service": "dil-programi-api", "docs": "/docs"}
