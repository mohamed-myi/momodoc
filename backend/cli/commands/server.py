import os
import platform
import signal
import socket

import typer
from rich.console import Console

console = Console()


def _is_port_free(host: str, port: int) -> bool:
    """Check if a port is available for binding."""
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        try:
            s.bind((host, port))
            return True
        except OSError:
            return False


def _is_process_alive(pid: int) -> bool:
    """Check if a process with the given PID is running."""
    try:
        os.kill(pid, 0)
        return True
    except (ProcessLookupError, PermissionError):
        return False


def _acquire_pid_lock(pid_path: str):
    """Acquire an exclusive lock on the PID file.

    Returns the open file descriptor (must stay open for process lifetime).
    Raises typer.Exit(1) if another instance holds the lock.
    """
    try:
        pid_fd = open(pid_path, "w")
    except OSError as exc:
        console.print(f"[red]Could not write PID file: {exc}[/red]")
        raise typer.Exit(1)
    try:
        if platform.system() == "Windows":
            import msvcrt

            msvcrt.locking(pid_fd.fileno(), msvcrt.LK_NBLCK, 1)
        else:
            import fcntl

            fcntl.flock(pid_fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except (BlockingIOError, OSError):
        console.print("[yellow]Another momodoc instance is already starting.[/yellow]")
        pid_fd.close()
        raise typer.Exit(1)

    pid_fd.write(str(os.getpid()))
    pid_fd.flush()
    return pid_fd


def serve(
    host: str = typer.Option("127.0.0.1", help="Host to bind to"),
    port: int = typer.Option(8000, help="Port to listen on"),
    reload: bool = typer.Option(False, help="Enable auto-reload for development"),
):
    """Start the momodoc backend server."""
    import uvicorn
    from app.config import Settings

    settings = Settings()

    # Note: Logging is configured in app/main.py lifespan, not here.
    # The CLI only prints to console via rich.console for pre-flight checks.

    pid_path = settings.pid_file_path
    if os.path.exists(pid_path):
        try:
            with open(pid_path) as f:
                existing_pid = int(f.read().strip())
            if _is_process_alive(existing_pid):
                msg = f"momodoc is already running (PID {existing_pid}). Use 'momodoc stop' first."
                console.print(f"[yellow]{msg}[/yellow]")
                raise typer.Exit(1)
        except (ValueError, OSError):
            pass
        # Stale PID file — clean up
        try:
            os.remove(pid_path)
        except FileNotFoundError:
            pass

    if not _is_port_free(host, port):
        console.print(f"[red]Port {port} is already in use.[/red]")
        raise typer.Exit(1)

    # Acquire exclusive file lock on PID file — prevents two backends from starting
    # simultaneously during rapid vite/Electron restarts. The lock is held for
    # the process lifetime and released automatically on exit/crash.
    pid_fd = _acquire_pid_lock(pid_path)

    try:
        with open(settings.port_file_path, "w") as f:
            f.write(str(port))
    except OSError as exc:
        pid_fd.close()
        console.print(f"[red]Could not write port file: {exc}[/red]")
        raise typer.Exit(1)

    console.print(f"[green]Starting momodoc on {host}:{port}[/green]")
    console.print(f"[dim]Data directory: {settings.data_dir}[/dim]")

    try:
        uvicorn.run(
            "app.main:app",
            host=host,
            port=port,
            reload=reload,
            log_level="info",
        )
    finally:
        pid_fd.close()
        # Cleanup PID/port files on exit
        for path in (pid_path, settings.port_file_path):
            try:
                os.remove(path)
            except OSError:
                pass


def stop():
    """Stop a running momodoc instance."""
    from app.config import Settings

    settings = Settings()
    pid_path = settings.pid_file_path

    if not os.path.exists(pid_path):
        console.print("[yellow]No running momodoc instance found.[/yellow]")
        raise typer.Exit(0)

    try:
        with open(pid_path) as f:
            pid = int(f.read().strip())
    except (ValueError, OSError):
        console.print("[red]Could not read PID file.[/red]")
        raise typer.Exit(1)

    if not _is_process_alive(pid):
        console.print("[yellow]Process not running. Cleaning up stale files.[/yellow]")
        _cleanup_files(settings)
        raise typer.Exit(0)

    console.print(f"Stopping momodoc (PID {pid})...")
    try:
        os.kill(pid, signal.SIGTERM)
    except ProcessLookupError:
        # Process exited between the alive check and the kill
        _cleanup_files(settings)
        console.print("[green]momodoc stopped.[/green]")
        return
    except PermissionError:
        console.print("[red]Permission denied sending SIGTERM. Is the PID stale?[/red]")
        raise typer.Exit(1)

    # Wait up to 5 seconds for graceful shutdown
    import time

    for _ in range(50):
        if not _is_process_alive(pid):
            break
        time.sleep(0.1)
    else:
        console.print("[yellow]Process did not stop gracefully, forcing...[/yellow]")
        try:
            os.kill(pid, signal.SIGKILL)
        except (ProcessLookupError, PermissionError):
            pass

    _cleanup_files(settings)
    console.print("[green]momodoc stopped.[/green]")


def status():
    """Check if momodoc is running."""
    from app.config import Settings

    settings = Settings()
    pid_path = settings.pid_file_path

    if not os.path.exists(pid_path):
        console.print("[dim]momodoc is not running.[/dim]")
        raise typer.Exit(0)

    try:
        with open(pid_path) as f:
            pid = int(f.read().strip())
    except (ValueError, OSError):
        console.print("[dim]momodoc is not running (invalid PID file).[/dim]")
        raise typer.Exit(0)

    if not _is_process_alive(pid):
        console.print("[dim]momodoc is not running (stale PID file).[/dim]")
        raise typer.Exit(0)

    port = "unknown"
    if os.path.exists(settings.port_file_path):
        try:
            with open(settings.port_file_path) as f:
                port = f.read().strip()
        except OSError:
            pass

    console.print("[green]momodoc is running[/green]")
    console.print(f"  PID:  {pid}")
    console.print(f"  Port: {port}")
    console.print(f"  URL:  http://127.0.0.1:{port}")
    console.print(f"  Data: {settings.data_dir}")


def _cleanup_files(settings) -> None:
    """Remove PID, port, and token files."""
    for path in (settings.pid_file_path, settings.port_file_path, settings.session_token_path):
        try:
            os.remove(path)
        except OSError:
            pass
