import os
import socket
import datetime
import logging
from sqlalchemy.orm import Session
from backend.app.models import SandboxPortAllocation

logger = logging.getLogger(__name__)

class PortManager:
    """
    Manages deterministic, conflict-free port allocations for multi-user worktrees
    and sandbox containers across different repositories.
    """

    def __init__(self):
        # Configurable port range for Docker published ports
        self.port_start = int(os.environ.get("SANDBOX_PORT_START", "10000"))
        self.port_end = int(os.environ.get("SANDBOX_PORT_END", "10100"))
        self.public_host = os.environ.get("SANDBOX_PUBLIC_HOST", "localhost")

    def _is_port_available(self, port: int) -> bool:
        """Checks if a port is physically available to bind on 0.0.0.0."""
        try:
            with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
                s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
                s.bind(("0.0.0.0", port))
                return True
        except Exception:
            return False

    def get_or_allocate_port(
        self,
        db: Session,
        repo_id: int | None = None,
        worktree_path: str | None = None,
        repo_name: str | None = None,
        branch: str | None = None,
    ) -> int:
        """
        Gets existing allocated port or allocates the next available port in the configured range.
        Ensures collision-free assignment across all repositories and worktrees.
        """
        clean_wt = os.path.abspath(worktree_path) if worktree_path else "main"
        alloc_key = f"repo:{repo_id or 0}:{clean_wt}"

        existing = db.query(SandboxPortAllocation).filter(
            SandboxPortAllocation.allocation_key == alloc_key
        ).first()

        # If already allocated and still within the configured range, keep it stable
        if existing and self.port_start <= existing.port <= self.port_end:
            existing.last_accessed_at = datetime.datetime.utcnow()
            try:
                db.commit()
            except Exception:
                db.rollback()
            return existing.port

        # Query all currently assigned ports in the database
        assigned_ports = set(
            p[0] for p in db.query(SandboxPortAllocation.port).all()
        )

        allocated_port = None
        # First preference: port not assigned in DB and physically available
        for candidate in range(self.port_start, self.port_end + 1):
            if candidate not in assigned_ports:
                if self._is_port_available(candidate):
                    allocated_port = candidate
                    break

        # Fallback: if all ports were assigned, check if any stale port is physically free
        if allocated_port is None:
            for candidate in range(self.port_start, self.port_end + 1):
                if self._is_port_available(candidate):
                    # Reclaim stale allocation
                    stale = db.query(SandboxPortAllocation).filter(
                        SandboxPortAllocation.port == candidate
                    ).first()
                    if stale:
                        db.delete(stale)
                    allocated_port = candidate
                    break

        if allocated_port is None:
            raise RuntimeError(
                f"No available ports in sandbox range {self.port_start}-{self.port_end}. "
                f"Increase SANDBOX_PORT_END or remove unused worktrees."
            )

        if existing:
            existing.port = allocated_port
            existing.last_accessed_at = datetime.datetime.utcnow()
        else:
            new_alloc = SandboxPortAllocation(
                allocation_key=alloc_key,
                port=allocated_port,
                repo_id=repo_id,
                repo_name=repo_name,
                worktree_path=worktree_path,
                branch=branch,
            )
            db.add(new_alloc)

        try:
            db.commit()
        except Exception as e:
            logger.warning(f"Failed to persist port allocation: {e}")
            db.rollback()

        return allocated_port

    def release_port(self, db: Session, repo_id: int | None, worktree_path: str | None):
        """Releases the allocated port when a worktree is removed."""
        clean_wt = os.path.abspath(worktree_path) if worktree_path else "main"
        alloc_key = f"repo:{repo_id or 0}:{clean_wt}"
        alloc = db.query(SandboxPortAllocation).filter(
            SandboxPortAllocation.allocation_key == alloc_key
        ).first()
        if alloc:
            db.delete(alloc)
            try:
                db.commit()
            except Exception:
                db.rollback()

    def get_preview_url(self, port: int, host_header: str | None = None) -> str:
        """Constructs accessible preview URL using public host or request host."""
        host = self.public_host
        if host_header and ":" in host_header:
            req_host = host_header.split(":")[0]
            if req_host not in ("0.0.0.0", "127.0.0.1", "localhost", "cockpit"):
                host = req_host
        return f"http://{host}:{port}"


port_manager = PortManager()
