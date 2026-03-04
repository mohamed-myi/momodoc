from fastapi import FastAPI


def register_routers(app: FastAPI) -> None:
    from app.routers import (
        batch,
        chat,
        directories,
        export,
        file_content,
        files,
        issues,
        llm,
        metrics,
        notes,
        projects,
        search,
        settings,
        ws,
    )

    app.include_router(projects.router, prefix="/api/v1", tags=["projects"])
    app.include_router(directories.router, prefix="/api/v1", tags=["directories"])
    app.include_router(files.router, prefix="/api/v1", tags=["files"])
    app.include_router(file_content.router, prefix="/api/v1", tags=["files"])
    app.include_router(batch.router, prefix="/api/v1", tags=["files"])
    app.include_router(notes.router, prefix="/api/v1", tags=["notes"])
    app.include_router(issues.router, prefix="/api/v1", tags=["issues"])
    app.include_router(chat.router, prefix="/api/v1", tags=["chat"])
    app.include_router(search.router, prefix="/api/v1", tags=["search"])
    app.include_router(export.router, prefix="/api/v1", tags=["export"])
    app.include_router(llm.router, prefix="/api/v1", tags=["llm"])
    app.include_router(settings.router, prefix="/api/v1", tags=["settings"])
    app.include_router(metrics.router, prefix="/api/v1", tags=["metrics"])
    app.include_router(ws.router, tags=["websocket"])
