from beanie import init_beanie
from motor.motor_asyncio import AsyncIOMotorClient

from app.config import settings
from app.models import ALL_MODELS, User


async def init_db() -> None:
    client = AsyncIOMotorClient(settings.mongodb_url)
    await init_beanie(database=client.get_default_database(), document_models=ALL_MODELS)
    existing = await User.find_one(User.user_id == settings.default_user_id)
    if not existing:
        await User(user_id=settings.default_user_id).insert()


async def check_db() -> bool:
    client = AsyncIOMotorClient(settings.mongodb_url)
    await client.admin.command("ping")
    return True
