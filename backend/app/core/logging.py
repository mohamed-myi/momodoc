"""Centralized logging configuration for momodoc."""

import logging
import os
import sys
from logging.handlers import RotatingFileHandler


def configure_logging(level: str = "INFO", log_dir: str | None = None) -> None:
    """Configure root logger with a consistent format.

    Args:
        level: Log level name (e.g. "DEBUG", "INFO", "WARNING").
        log_dir: If provided, also write logs to a rotating file in this directory.
    """
    fmt = "%(asctime)s %(levelname)-8s %(name)-20s %(message)s"
    datefmt = "%Y-%m-%d %H:%M:%S"

    # Always log to stdout
    stdout_handler = logging.StreamHandler(sys.stdout)
    stdout_handler.setFormatter(logging.Formatter(fmt, datefmt=datefmt))
    handlers: list[logging.Handler] = [stdout_handler]

    if log_dir:
        # Main application log
        log_path = os.path.join(log_dir, "momodoc.log")
        file_handler = RotatingFileHandler(
            log_path, maxBytes=10 * 1024 * 1024, backupCount=5, encoding="utf-8"
        )
        file_handler.setFormatter(logging.Formatter(fmt, datefmt=datefmt))
        handlers.append(file_handler)

        # Startup-specific log for debugging initialization issues
        startup_log_path = os.path.join(log_dir, "momodoc-startup.log")
        startup_handler = RotatingFileHandler(
            startup_log_path, maxBytes=5 * 1024 * 1024, backupCount=3, encoding="utf-8"
        )
        startup_handler.setFormatter(logging.Formatter(fmt, datefmt=datefmt))
        startup_handler.setLevel(logging.DEBUG)  # Capture everything during startup
        handlers.append(startup_handler)

    logging.basicConfig(
        level=getattr(logging, level.upper(), logging.INFO),
        format=fmt,
        datefmt=datefmt,
        force=True,
        handlers=handlers,
    )

    # Configure uvicorn loggers to use our handlers
    for logger_name in ("uvicorn", "uvicorn.error", "uvicorn.access"):
        uvicorn_logger = logging.getLogger(logger_name)
        # Use independent list containers per logger to prevent cross-mutation.
        uvicorn_logger.handlers = list(handlers)
        uvicorn_logger.propagate = False

    # Silence noisy third-party loggers
    for noisy in ("httpcore", "httpx", "urllib3"):
        logging.getLogger(noisy).setLevel(logging.WARNING)

    # Ensure alembic logs are captured
    logging.getLogger("alembic").setLevel(logging.INFO)
