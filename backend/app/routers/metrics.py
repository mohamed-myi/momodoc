import logging

from fastapi import APIRouter, Depends, Query, Request
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import Settings
from app.dependencies import get_db, get_settings
from app.services import metrics_service

logger = logging.getLogger(__name__)

router = APIRouter()


@router.get("/metrics/overview")
async def get_overview(
    request: Request,
    db: AsyncSession = Depends(get_db),
    settings: Settings = Depends(get_settings),
):
    start_time = getattr(request.app.state, "start_time", 0.0)
    return await metrics_service.get_overview(db, settings, start_time)


@router.get("/metrics/projects")
async def get_project_metrics(
    db: AsyncSession = Depends(get_db),
):
    return await metrics_service.get_project_metrics(db)


@router.get("/metrics/chat")
async def get_chat_metrics(
    days: int = Query(default=30, ge=1, le=365),
    db: AsyncSession = Depends(get_db),
):
    return await metrics_service.get_chat_metrics(db, days)


@router.get("/metrics/storage")
async def get_storage_metrics(
    db: AsyncSession = Depends(get_db),
    settings: Settings = Depends(get_settings),
):
    return await metrics_service.get_storage_metrics(db, settings)


@router.get("/metrics/sync")
async def get_sync_metrics(
    days: int = Query(default=30, ge=1, le=365),
    db: AsyncSession = Depends(get_db),
):
    return await metrics_service.get_sync_metrics(db, days)
