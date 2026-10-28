import asyncio
import json
import logging
import os
import signal
import time
import pty
import fcntl
import termios
import struct
from pathlib import Path
from typing import AsyncGenerator

logger = logging.getLogger("terminal_service")


class PtyTerminalSession:
    """Represents an active interactive pseudo-terminal (PTY) session running a shell."""

    def __init__(self, session_key: str, cwd: Path, assigned_port: int | None = None):
        self.session_key = session_key
        self.cwd = cwd
        self.assigned_port = assigned_port
        self.master_fd: int | None = None
        self.proc: asyncio.subprocess.Process | None = None
        self._closed = False
        self.cols = 80
        self.rows = 24
        self._scrollback = bytearray()
        self._max_scrollback = 256 * 1024  # 256 KB ring buffer for terminal history persistence across browser reloads
        self._subscribers: set[asyncio.Queue[str]] = set()
        self._reader_task: asyncio.Task | None = None

    def append_scrollback(self, data: bytes):
        if not data:
            return
        self._scrollback.extend(data)
        if len(self._scrollback) > self._max_scrollback:
            excess = len(self._scrollback) - self._max_scrollback
            del self._scrollback[:excess]

    def get_scrollback(self) -> str:
        return self._scrollback.decode("utf-8", errors="replace")

    def clear_scrollback(self):
        self._scrollback.clear()

    def subscribe(self, q: asyncio.Queue[str]):
        self._subscribers.add(q)

    def unsubscribe(self, q: asyncio.Queue[str]):
        self._subscribers.discard(q)

    async def _reader_loop(self):
        """Continuously reads bytes from PTY master fd into the scrollback ring buffer and broadcasts to subscribers."""
        while not self._closed and self.master_fd is not None:
            try:
                data = await asyncio.to_thread(os.read, self.master_fd, 2048)
                if not data:
                    break
                self.append_scrollback(data)
                text = data.decode("utf-8", errors="replace")
                for q in list(self._subscribers):
                    try:
                        q.put_nowait(text)
                    except Exception:
                        pass
            except (OSError, asyncio.CancelledError):
                break
            except Exception as e:
                logger.debug(f"PTY reader loop exception: {e}")
                break
        if not self._closed:
            end_msg = "\r\n\x1b[33m[Shell session ended. Click Restart to spawn a new shell]\x1b[0m\r\n"
            for q in list(self._subscribers):
                try:
                    q.put_nowait(end_msg)
                except Exception:
                    pass

    async def start(self, initial_cols: int = 80, initial_rows: int = 24):
        self.cols = max(10, initial_cols)
        self.rows = max(5, initial_rows)
        master_fd, slave_fd = pty.openpty()
        self.master_fd = master_fd
        self._closed = False

        self.resize(self.cols, self.rows)

        env = os.environ.copy()
        env["TERM"] = "xterm-256color"
        env["COLORTERM"] = "truecolor"
        env["LANG"] = "en_US.UTF-8"
        env["FORCE_COLOR"] = "1"
        env["PYTHONUNBUFFERED"] = "1"
        env["HOST"] = "0.0.0.0"
        if self.assigned_port:
            env["PORT"] = str(self.assigned_port)
            env["APP_PORT"] = str(self.assigned_port)
            env["VITE_PORT"] = str(self.assigned_port)
            env["UVICORN_PORT"] = str(self.assigned_port)

        self.proc = await asyncio.create_subprocess_exec(
            "/bin/bash",
            "--login",
            stdin=slave_fd,
            stdout=slave_fd,
            stderr=slave_fd,
            cwd=str(self.cwd),
            env=env,
            preexec_fn=os.setsid if hasattr(os, "setsid") else None,
        )
        os.close(slave_fd)
        if self._reader_task and not self._reader_task.done():
            self._reader_task.cancel()
        self._reader_task = asyncio.create_task(self._reader_loop())
        return self

    def resize(self, cols: int, rows: int):
        self.cols = max(10, cols)
        self.rows = max(5, rows)
        if self.master_fd is not None and not self._closed:
            try:
                winsize = struct.pack("HHHH", self.rows, self.cols, 0, 0)
                fcntl.ioctl(self.master_fd, termios.TIOCSWINSZ, winsize)
            except Exception as e:
                logger.debug(f"Failed to resize PTY: {e}")

    def write(self, data: bytes | str):
        if self.master_fd is not None and not self._closed:
            try:
                if isinstance(data, str):
                    data = data.encode("utf-8")
                os.write(self.master_fd, data)
            except Exception as e:
                logger.debug(f"Failed to write to PTY: {e}")

    def close(self):
        if self._closed:
            return
        self._closed = True
        if self._reader_task and not self._reader_task.done():
            self._reader_task.cancel()
            self._reader_task = None
        self._subscribers.clear()
        self._scrollback.clear()
        if self.master_fd is not None:
            try:
                os.close(self.master_fd)
            except Exception:
                pass
            self.master_fd = None
        if self.proc and self.proc.returncode is None:
            try:
                if hasattr(os, "killpg") and hasattr(os, "getpgid"):
                    os.killpg(os.getpgid(self.proc.pid), signal.SIGTERM)
                else:
                    self.proc.terminate()
            except Exception:
                pass


class PtySessionManager:
    """Manages pool of interactive PTY sessions keyed by repository/worktree."""

    def __init__(self):
        self._sessions: dict[str, PtyTerminalSession] = {}

    def get_or_create(self, session_key: str, cwd: Path, assigned_port: int | None = None) -> PtyTerminalSession:
        existing = self._sessions.get(session_key)
        if existing and not existing._closed and existing.proc and existing.proc.returncode is None:
            return existing
        if existing:
            existing.close()
        sess = PtyTerminalSession(session_key, cwd, assigned_port)
        self._sessions[session_key] = sess
        return sess

    def remove(self, session_key: str):
        sess = self._sessions.pop(session_key, None)
        if sess:
            sess.close()


pty_manager = PtySessionManager()


class TerminalProcessManager:
    """Manages active terminal processes, live streaming output, and process termination."""

    def __init__(self):
        self._active_processes: dict[str, asyncio.subprocess.Process] = {}

    def register(self, session_id: str, proc: asyncio.subprocess.Process):
        self._active_processes[session_id] = proc

    def unregister(self, session_id: str):
        self._active_processes.pop(session_id, None)

    async def kill(self, session_id: str) -> bool:
        """Kills the active process and its entire process group cleanly."""
        proc = self._active_processes.get(session_id)
        if not proc:
            return False
        try:
            if hasattr(os, "getpgid") and hasattr(os, "killpg"):
                pgid = os.getpgid(proc.pid)
                os.killpg(pgid, signal.SIGTERM)
                # Wait briefly for graceful shutdown
                for _ in range(5):
                    await asyncio.sleep(0.1)
                    if proc.returncode is not None:
                        break
                if proc.returncode is None:
                    os.killpg(pgid, signal.SIGKILL)
            else:
                proc.terminate()
                await asyncio.sleep(0.5)
                if proc.returncode is None:
                    proc.kill()
            return True
        except ProcessLookupError:
            return True
        except Exception as e:
            logger.warning(f"Notice while terminating terminal process for {session_id}: {e}")
            try:
                proc.kill()
                return True
            except Exception:
                return False

    async def stream_command(
        self,
        command: str,
        cwd: Path,
        assigned_port: int | None = None,
        session_id: str | None = None,
        timeout: int = 600,
    ) -> AsyncGenerator[str, None]:
        """
        Executes a command asynchronously, streaming stdout and stderr live via SSE frames.
        Tracks the active process by session_id to allow on-demand termination.
        """
        start_t = time.time()

        forbidden = ["rm -rf /", "mkfs", "dd if=", ":(){ :|:& };:", "> /dev/sda"]
        for f in forbidden:
            if f in command:
                err_event = {
                    "type": "done",
                    "exit_code": 1,
                    "duration_ms": 0,
                    "status": "blocked",
                    "detail": f"Command blocked: prohibited pattern '{f}'.",
                }
                yield f"data: {json.dumps(err_event)}\n\n"
                return

        env = os.environ.copy()
        env["TERM"] = "xterm-256color"
        env["FORCE_COLOR"] = "1"
        env["PYTHONUNBUFFERED"] = "1"
        env["HOST"] = "0.0.0.0"

        if assigned_port:
            env["PORT"] = str(assigned_port)
            env["APP_PORT"] = str(assigned_port)
            env["VITE_PORT"] = str(assigned_port)
            env["UVICORN_PORT"] = str(assigned_port)

        proc = None
        try:
            # Start process in its own process group (preexec_fn=os.setsid) so child processes are killed cleanly
            proc = await asyncio.create_subprocess_shell(
                command,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
                cwd=str(cwd),
                env=env,
                preexec_fn=os.setsid if hasattr(os, "setsid") else None,
            )

            if session_id:
                self.register(session_id, proc)

            yield f"data: {json.dumps({'type': 'start', 'session_id': session_id, 'pid': proc.pid, 'assigned_port': assigned_port})}\n\n"

            queue: asyncio.Queue[tuple[str, str]] = asyncio.Queue()

            async def pump_stream(stream: asyncio.StreamReader, stream_name: str):
                while True:
                    try:
                        chunk = await stream.read(512)
                        if not chunk:
                            break
                        await queue.put((stream_name, chunk.decode("utf-8", errors="replace")))
                    except Exception:
                        break

            stdout_task = asyncio.create_task(pump_stream(proc.stdout, "stdout"))
            stderr_task = asyncio.create_task(pump_stream(proc.stderr, "stderr"))

            # Stream output chunks as they arrive
            while True:
                if stdout_task.done() and stderr_task.done() and queue.empty():
                    break
                try:
                    stream_name, text = await asyncio.wait_for(queue.get(), timeout=0.1)
                    if "Address already in use" in text or "EADDRINUSE" in text:
                        port_hint = f" (Your sandbox assigned port is {assigned_port})" if assigned_port else ""
                        text += f"\n\n💡 [AI Studio Port Notice] Port collision detected{port_hint}.\nYour worktree has an assigned conflict-free port: {assigned_port or '$PORT'}.\nRun your command using: 'uvicorn main:app --port $PORT' or 'npm run dev -- --port $PORT'."
                    yield f"data: {json.dumps({'type': 'output', 'stream': stream_name, 'chunk': text})}\n\n"
                except asyncio.TimeoutError:
                    if time.time() - start_t > timeout:
                        if session_id:
                            await self.kill(session_id)
                        yield f"data: {json.dumps({'type': 'error', 'detail': f'Command timed out after {timeout} seconds'})}\n\n"
                        break
                    continue

            exit_code = await proc.wait()
            duration_ms = int((time.time() - start_t) * 1000)
            status = "success" if exit_code == 0 else "failed"

            yield f"data: {json.dumps({'type': 'done', 'exit_code': exit_code, 'duration_ms': duration_ms, 'status': status})}\n\n"

        except asyncio.CancelledError:
            # Client disconnected
            if session_id:
                await self.kill(session_id)
            raise
        except Exception as e:
            logger.error(f"Terminal execution error: {e}")
            yield f"data: {json.dumps({'type': 'error', 'detail': str(e)})}\n\n"
        finally:
            if session_id:
                self.unregister(session_id)
            if proc and proc.returncode is None:
                try:
                    if hasattr(os, "killpg") and hasattr(os, "getpgid"):
                        os.killpg(os.getpgid(proc.pid), signal.SIGTERM)
                    else:
                        proc.kill()
                except Exception:
                    pass


terminal_manager = TerminalProcessManager()
