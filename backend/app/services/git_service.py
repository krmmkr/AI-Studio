from collections import defaultdict
import logging
import os
from pathlib import Path
import re
import shutil
import subprocess
from typing import Any
from backend.app.config import REPOS_DIR
from backend.app.services.duckdb_service import duckdb_service

logger = logging.getLogger("git_service")

CONVENTIONAL_COMMIT_PATTERN = re.compile(
    r"^(feat|feature|fix|bug|perf|performance|refactor|refact|docs|doc|test|tests|chore|build|ci|style)(?:\(([^)]+)\))?!?\s*:",
    re.IGNORECASE,
)


def classify_commit_message(msg: str) -> tuple[str, int]:
    """Classifies a commit message into a normalized conventional commit type and impact weight."""
    m = CONVENTIONAL_COMMIT_PATTERN.match((msg or "").strip())
    raw_type = m.group(1).lower() if m else "other"
    if raw_type in ("feat", "feature"):
        return "feat", 3
    if raw_type in ("fix", "bug"):
        return "fix", 2
    if raw_type in ("perf", "performance"):
        return "perf", 3
    if raw_type in ("refactor", "refact"):
        return "refactor", 2
    if raw_type in ("test", "tests"):
        return "test", 1
    if raw_type in ("docs", "doc"):
        return "docs", 1
    if raw_type in ("chore", "build", "ci", "style"):
        return "chore", 1
    return "other", 1


class GitService:
    @staticmethod
    def sanitize_repo_name(name: str) -> str:
        """Sanitizes a repository name to prevent path traversal and ensure filesystem safety."""
        clean = re.sub(r"[^a-zA-Z0-9_\-\.]", "-", name.strip())
        if clean.endswith(".git"):
            clean = clean[:-4]
        clean = clean.strip(".-")
        if not clean:
            raise ValueError("Invalid repository name: name must contain alphanumeric characters.")
        return clean

    @staticmethod
    def normalize_remote_url(remote_url: str) -> tuple[str, str | None]:
        """
        Normalizes a remote URL and generates an HTTPS fallback if an SSH GitHub/GitLab URL is provided.
        Returns: (primary_url, fallback_https_url)
        """
        url = remote_url.strip()
        fallback = None

        # Matches git@github.com:owner/repo.git or git@gitlab.com:owner/repo.git
        ssh_match = re.match(r"^git@([^:]+):([^/]+)/(.+?)(?:\.git)?$", url)
        if ssh_match:
            host, owner, repo = ssh_match.groups()
            fallback = f"https://{host}/{owner}/{repo}.git"

        # Matches ssh://git@github.com/owner/repo.git
        ssh_proto_match = re.match(r"^ssh://git@([^/]+)/([^/]+)/(.+?)(?:\.git)?$", url)
        if ssh_proto_match:
            host, owner, repo = ssh_proto_match.groups()
            fallback = f"https://{host}/{owner}/{repo}.git"

        return url, fallback

    def is_repo_cloned(self, local_path: str) -> bool:
        """Verifies if a path exists on disk and is a valid working-tree or bare git repository."""
        p = Path(local_path).resolve()
        if not p.exists() or not p.is_dir():
            # Also check if `<path>.git` exists for bare clones
            alt = Path(f"{local_path}.git").resolve()
            if alt.exists() and alt.is_dir() and (alt / "HEAD").is_file() and (alt / "objects").is_dir():
                return True
            return False
        if (p / ".git").is_dir() or (p / ".git").is_file():
            return True
        if (p / "HEAD").is_file() and (p / "objects").is_dir():
            return True
        return False

    def resolve_repo_dir(self, repo_or_path: str) -> Path:
        """Resolves a repository name or path to an existing git directory on disk."""
        candidate = Path(repo_or_path)
        if candidate.is_absolute() and self.is_repo_cloned(str(candidate)):
            if not candidate.exists() and Path(f"{candidate}.git").exists():
                return Path(f"{candidate}.git").resolve()
            return candidate.resolve()

        direct = (REPOS_DIR / repo_or_path).resolve()
        if self.is_repo_cloned(str(direct)):
            if not direct.exists() and Path(f"{direct}.git").exists():
                return Path(f"{direct}.git").resolve()
            return direct

        if REPOS_DIR.exists():
            needle = repo_or_path.lower().removesuffix(".git")
            for p in REPOS_DIR.iterdir():
                if p.is_dir() and self.is_repo_cloned(str(p)):
                    stem = p.name.lower().removesuffix(".git")
                    if stem == needle or needle in stem or stem in needle:
                        return p.resolve()

        return direct

    def _run_git(self, args: list[str], cwd: Path | None = None, timeout: int = 120) -> tuple[int, str, str]:
        """Executes a git command non-interactively with safe terminal environment."""
        env = os.environ.copy()
        env["GIT_TERMINAL_PROMPT"] = "0"
        env["GIT_SSH_COMMAND"] = "ssh -o BatchMode=yes -o StrictHostKeyChecking=accept-new"

        try:
            res = subprocess.run(
                ["git"] + args,
                cwd=cwd,
                capture_output=True,
                text=True,
                timeout=timeout,
                env=env,
            )
            return res.returncode, res.stdout.strip(), res.stderr.strip()
        except subprocess.TimeoutExpired:
            return 124, "", f"Git command timed out after {timeout} seconds."
        except Exception as e:
            return 1, "", str(e)

    def clone_repository(
        self,
        name: str,
        remote_url: str,
        clone_type: str = "full",
        default_branch: str = "",
    ) -> dict[str, Any]:
        """
        Clones a remote repository to the persistent REPOS_DIR.
        Includes automatic fallback from SSH to HTTPS and automatic default branch resolution.
        """
        safe_name = self.sanitize_repo_name(name)
        target_dir = (REPOS_DIR / safe_name).resolve()
        primary_url, fallback_https_url = self.normalize_remote_url(remote_url)

        if self.is_repo_cloned(str(target_dir)):
            logger.info(f"Repository '{safe_name}' already exists at {target_dir}. Syncing latest commits...")
            return self.sync_repository(str(target_dir), default_branch, primary_url)

        if target_dir.exists():
            shutil.rmtree(target_dir, ignore_errors=True)

        branch_arg = default_branch.strip() if default_branch and default_branch.strip().lower() not in ("auto", "") else ""

        def build_args(url: str, branch: str = "") -> list[str]:
            args = ["clone"]
            if clone_type == "shallow":
                args += ["--depth", "500"]
            if branch:
                args += ["--branch", branch]
            args += [url, str(target_dir)]
            return args

        logger.info(f"Cloning '{safe_name}' from {primary_url} into {target_dir}...")
        rc, stdout, stderr = self._run_git(build_args(primary_url, branch_arg), timeout=180)

        # If branch was explicitly set (e.g. 'main') and not found on remote, retry auto-detecting remote HEAD branch
        if rc != 0 and branch_arg and "Remote branch" in stderr and "not found" in stderr:
            logger.info(f"Branch '{branch_arg}' not found on remote; retrying clone with remote default HEAD...")
            if target_dir.exists():
                shutil.rmtree(target_dir, ignore_errors=True)
            rc, stdout, stderr = self._run_git(build_args(primary_url, ""), timeout=180)
            branch_arg = ""

        effective_url = primary_url
        used_fallback = False

        # Fallback to HTTPS if SSH authentication failed
        if rc != 0 and fallback_https_url and any(
            err in stderr for err in ("Permission denied (publickey)", "Could not read from remote", "Host key verification failed")
        ):
            logger.warning(f"SSH clone failed for {primary_url}. Retrying with HTTPS fallback: {fallback_https_url}...")
            if target_dir.exists():
                shutil.rmtree(target_dir, ignore_errors=True)
            rc, stdout, stderr = self._run_git(build_args(fallback_https_url, branch_arg), timeout=180)
            if rc != 0 and branch_arg and "Remote branch" in stderr and "not found" in stderr:
                if target_dir.exists():
                    shutil.rmtree(target_dir, ignore_errors=True)
                rc, stdout, stderr = self._run_git(build_args(fallback_https_url, ""), timeout=180)
            if rc == 0:
                effective_url = fallback_https_url
                used_fallback = True

        if rc != 0:
            if target_dir.exists():
                shutil.rmtree(target_dir, ignore_errors=True)
            error_msg = stderr or "Unknown git error during clone."
            raise ValueError(f"Git clone failed: {error_msg}")

        meta = self.extract_repo_metadata(target_dir, safe_name)
        meta["used_fallback"] = used_fallback
        meta["effective_url"] = effective_url
        meta["local_path"] = str(target_dir)
        return meta

    def sync_repository(
        self,
        local_path: str,
        default_branch: str = "main",
        remote_url: str | None = None,
    ) -> dict[str, Any]:
        """
        Fetches and pulls incremental commits for an existing repository clone.
        If the directory is missing but remote_url is provided, automatically triggers a fresh clone.
        """
        target_dir = self.resolve_repo_dir(local_path)

        if not self.is_repo_cloned(str(target_dir)):
            if remote_url:
                repo_name = self.sanitize_repo_name(target_dir.name or "repo")
                logger.info(f"Path '{local_path}' missing git repository. Triggering fresh clone from {remote_url}...")
                return self.clone_repository(repo_name, remote_url, "full", default_branch)
            raise ValueError(f"Repository directory '{local_path}' does not exist or has no .git metadata.")

        safe_name = self.sanitize_repo_name(target_dir.name)
        is_bare = (target_dir / "HEAD").is_file() and not (target_dir / ".git").exists()

        # 1. Fetch remote changes
        rc, _, err = self._run_git(["fetch", "--all", "--prune"], cwd=target_dir)
        if rc != 0:
            logger.warning(f"Git fetch returned code {rc}: {err}")

        # 2. Get current branch
        _, current_branch, _ = self._run_git(["rev-parse", "--abbrev-ref", "HEAD"], cwd=target_dir)
        branch = current_branch if current_branch and current_branch != "HEAD" else (default_branch or "main")

        # 3. Pull / fast-forward merge if working tree
        if not is_bare:
            self._run_git(["merge", "--ff-only", f"origin/{branch}"], cwd=target_dir)

        meta = self.extract_repo_metadata(target_dir, safe_name)
        meta["local_path"] = str(target_dir)
        return meta

    def extract_repo_metadata(self, target_dir: Path, safe_name: str, limit: int = 500) -> dict[str, Any]:
        """Extracts HEAD commit, branch, total commit count, and ingests rich commit & contributor telemetry into DuckDB."""
        target_dir = self.resolve_repo_dir(str(target_dir))
        safe_name = self.sanitize_repo_name(safe_name)

        _, head_sha, _ = self._run_git(["rev-parse", "HEAD"], cwd=target_dir)
        _, branch, _ = self._run_git(["rev-parse", "--abbrev-ref", "HEAD"], cwd=target_dir)
        if not branch or branch == "HEAD":
            # For bare repos or detached HEAD, inspect symbolic-ref
            _, sym_ref, _ = self._run_git(["symbolic-ref", "--short", "HEAD"], cwd=target_dir)
            branch = sym_ref or "main"

        _, count_str, _ = self._run_git(["rev-list", "--count", "HEAD"], cwd=target_dir)
        _, last_commit_msg, _ = self._run_git(["log", "-1", "--pretty=%s"], cwd=target_dir)
        _, last_commit_author, _ = self._run_git(["log", "-1", "--pretty=%an"], cwd=target_dir)

        try:
            commit_count = int(count_str) if count_str.isdigit() else 0
        except Exception:
            commit_count = 0

        _, log_output, _ = self._run_git(
            [
                "log",
                "-n",
                str(limit),
                "--numstat",
                "--date=iso-strict",
                "--pretty=format:COMMIT_RECORD%x1f%H%x1f%an%x1f%ae%x1f%ad%x1f%s",
            ],
            cwd=target_dir,
            timeout=90,
        )

        commits_to_ingest = []
        if log_output:
            current_commit = None
            for raw_line in log_output.split("\n"):
                line = raw_line.strip()
                if not line:
                    continue
                if line.startswith("COMMIT_RECORD\x1f"):
                    if current_commit:
                        commits_to_ingest.append(current_commit)
                    parts = line.split("\x1f")
                    c_sha = parts[1] if len(parts) > 1 else ""
                    c_author = parts[2] if len(parts) > 2 else "Unknown"
                    c_email = parts[3] if len(parts) > 3 else ""
                    c_date = parts[4] if len(parts) > 4 else "2026-01-01T00:00:00"
                    c_msg = parts[5] if len(parts) > 5 else ""
                    ctype, weight = classify_commit_message(c_msg)
                    current_commit = {
                        "commit_id": c_sha[:10],
                        "author": c_author,
                        "author_email": c_email,
                        "repo": safe_name,
                        "branch": branch,
                        "commit_type": ctype,
                        "impact_weight": weight,
                        "files_changed": 0,
                        "message": c_msg,
                        "lines_added": 0,
                        "lines_deleted": 0,
                        "committed_at": c_date[:19].replace("T", " "),
                    }
                elif current_commit and "\t" in line:
                    stat_parts = line.split("\t")
                    if len(stat_parts) >= 2:
                        added_str, deleted_str = stat_parts[0], stat_parts[1]
                        added = int(added_str) if added_str.isdigit() else 0
                        deleted = int(deleted_str) if deleted_str.isdigit() else 0
                        current_commit["lines_added"] += added
                        current_commit["lines_deleted"] += deleted
                        current_commit["files_changed"] += 1

            if current_commit:
                commits_to_ingest.append(current_commit)

        return {
            "name": safe_name,
            "branch": branch or "main",
            "head_sha": head_sha[:10] if head_sha else "",
            "commit_count": commit_count,
            "last_commit_msg": last_commit_msg or "",
            "last_commit_author": last_commit_author or "",
            "ingested_commits": len(commits_to_ingest),
        }

    def get_repository_branches(self, local_path: str) -> dict[str, Any]:
        """Lists local and remote branches for a repository, returning current branch and unique branch names."""
        target_dir = self.resolve_repo_dir(local_path)
        if not self.is_repo_cloned(str(target_dir)):
            raise ValueError(f"Path '{local_path}' is not a valid git repository.")

        rc, stdout, stderr = self._run_git(["branch", "-a"], cwd=target_dir)
        if rc != 0:
            raise ValueError(f"Failed to fetch branches: {stderr}")

        current_branch = "main"
        branch_set: set[str] = set()

        for raw_line in stdout.split("\n"):
            line = raw_line.strip()
            if not line:
                continue
            is_current = line.startswith("*")
            cleaned = line.lstrip("* ").strip()
            if "->" in cleaned or cleaned.startswith("(HEAD detached"):
                continue
            if cleaned.startswith("remotes/origin/"):
                cleaned = cleaned[len("remotes/origin/") :]
            elif cleaned.startswith("remotes/"):
                parts = cleaned.split("/")
                cleaned = "/".join(parts[2:]) if len(parts) > 2 else cleaned

            if is_current and cleaned:
                current_branch = cleaned

            if cleaned:
                branch_set.add(cleaned)

        def sort_priority(b: str) -> tuple[int, str]:
            b_lower = b.lower()
            if b_lower in ("master", "main", "trunk"):
                return (0, b)
            if b_lower in ("dev", "develop", "development"):
                return (1, b)
            if re.match(r"^\d+\.\d+", b):
                return (2, b)
            return (3, b)

        sorted_branches = sorted(branch_set, key=sort_priority)
        if current_branch not in sorted_branches and current_branch:
            sorted_branches.insert(0, current_branch)

        return {
            "current_branch": current_branch,
            "branches": sorted_branches,
        }

    def switch_repository_branch(self, local_path: str, branch_name: str) -> dict[str, Any]:
        """Switches the active branch in the local repository and updates metadata."""
        target_dir = self.resolve_repo_dir(local_path)
        if not self.is_repo_cloned(str(target_dir)):
            raise ValueError(f"Path '{local_path}' is not a valid git repository.")

        safe_branch = branch_name.strip()
        is_bare = (target_dir / "HEAD").is_file() and not (target_dir / ".git").exists()
        if is_bare:
            rc, stdout, stderr = self._run_git(["symbolic-ref", "HEAD", f"refs/heads/{safe_branch}"], cwd=target_dir)
            if rc != 0:
                raise ValueError(f"Failed to switch bare repo branch '{safe_branch}': {stderr}")
        else:
            rc, stdout, stderr = self._run_git(["checkout", safe_branch], cwd=target_dir)
            if rc != 0:
                rc, stdout, stderr = self._run_git(["checkout", "-b", safe_branch, f"origin/{safe_branch}"], cwd=target_dir)
                if rc != 0:
                    raise ValueError(f"Failed to switch to branch '{safe_branch}': {stderr}")

        meta = self.extract_repo_metadata(target_dir, self.sanitize_repo_name(target_dir.name))
        meta["local_path"] = str(target_dir)
        return meta

    def clone_repository_with_progress(
        self,
        name: str,
        remote_url: str,
        clone_type: str = "full",
        default_branch: str = "",
    ):
        """
        Clones a remote repository yielding progress update events:
        {"stage": "...", "percent": 0-100, "detail": "..."}
        Includes automatic default branch resolution and SSH-to-HTTPS fallback.
        """
        safe_name = self.sanitize_repo_name(name)
        target_dir = (REPOS_DIR / safe_name).resolve()
        primary_url, fallback_https_url = self.normalize_remote_url(remote_url)

        if self.is_repo_cloned(str(target_dir)):
            yield {"stage": "syncing", "percent": 50, "detail": f"Repository '{safe_name}' already exists. Syncing latest commits..."}
            meta = self.sync_repository(str(target_dir), default_branch, primary_url)
            yield {"stage": "completed", "percent": 100, "detail": "Repository synced and ingested into DuckDB.", "metadata": meta}
            return

        if target_dir.exists():
            shutil.rmtree(target_dir, ignore_errors=True)

        branch_arg = default_branch.strip() if default_branch and default_branch.strip().lower() not in ("auto", "main", "") else ""

        def run_streaming_clone(url: str, branch: str):
            args = ["git", "clone", "--progress"]
            if clone_type == "shallow":
                args += ["--depth", "500"]
            if branch:
                args += ["--branch", branch]
            args += [url, str(target_dir)]

            env = os.environ.copy()
            env["GIT_TERMINAL_PROMPT"] = "0"
            env["GIT_SSH_COMMAND"] = "ssh -o BatchMode=yes -o StrictHostKeyChecking=accept-new"

            proc = subprocess.Popen(
                args,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
                bufsize=1,
                env=env,
            )

            buffer = ""
            error_lines: list[str] = []
            while True:
                char = proc.stderr.read(1) if proc.stderr else ""
                if not char and proc.poll() is not None:
                    break
                if char in ("\r", "\n"):
                    line = buffer.strip()
                    buffer = ""
                    if line:
                        if any(k in line.lower() for k in ("fatal:", "error:", "permission denied", "not found", "could not")):
                            error_lines.append(line)
                        percent = None
                        stage = "transferring"
                        if "Counting objects:" in line:
                            stage = "counting"
                            m = re.search(r"(\d+)%", line)
                            percent = min(15, int(m.group(1)) * 0.15) if m else 10
                        elif "Compressing objects:" in line:
                            stage = "compressing"
                            m = re.search(r"(\d+)%", line)
                            percent = 15 + min(20, int(m.group(1)) * 0.20) if m else 25
                        elif "Receiving objects:" in line:
                            stage = "receiving"
                            m = re.search(r"(\d+)%", line)
                            percent = 35 + min(45, int(m.group(1)) * 0.45) if m else 60
                        elif "Resolving deltas:" in line:
                            stage = "resolving"
                            m = re.search(r"(\d+)%", line)
                            percent = 80 + min(15, int(m.group(1)) * 0.15) if m else 90
                        elif "Updating files:" in line:
                            stage = "updating"
                            percent = 95

                        yield {
                            "stage": stage,
                            "percent": int(percent) if percent is not None else 50,
                            "detail": line,
                            "_rc": None,
                            "_errors": error_lines,
                        }
                else:
                    buffer += char

            if buffer.strip():
                error_lines.append(buffer.strip())
            rc = proc.wait()
            yield {"_rc": rc, "_errors": error_lines}

        yield {"stage": "starting", "percent": 5, "detail": f"Initializing clone from {primary_url}..."}

        rc = 1
        errors: list[str] = []
        for ev in run_streaming_clone(primary_url, branch_arg):
            if ev.get("_rc") is not None:
                rc = ev["_rc"]
                errors = ev["_errors"]
            else:
                yield {k: v for k, v in ev.items() if not k.startswith("_")}

        # Retry without explicit branch if remote branch was not found
        err_joined = " | ".join(errors)
        if rc != 0 and branch_arg and "Remote branch" in err_joined and "not found" in err_joined:
            if target_dir.exists():
                shutil.rmtree(target_dir, ignore_errors=True)
            yield {"stage": "starting", "percent": 10, "detail": f"Branch '{branch_arg}' not on remote; cloning remote default HEAD..."}
            for ev in run_streaming_clone(primary_url, ""):
                if ev.get("_rc") is not None:
                    rc = ev["_rc"]
                    errors = ev["_errors"]
                else:
                    yield {k: v for k, v in ev.items() if not k.startswith("_")}

        # Retry with HTTPS fallback if SSH failed
        err_joined = " | ".join(errors)
        if rc != 0 and fallback_https_url and any(
            k in err_joined for k in ("Permission denied", "Could not read from remote", "Host key verification failed")
        ):
            if target_dir.exists():
                shutil.rmtree(target_dir, ignore_errors=True)
            yield {"stage": "starting", "percent": 10, "detail": f"SSH auth unavailable; retrying via HTTPS ({fallback_https_url})..."}
            for ev in run_streaming_clone(fallback_https_url, ""):
                if ev.get("_rc") is not None:
                    rc = ev["_rc"]
                    errors = ev["_errors"]
                else:
                    yield {k: v for k, v in ev.items() if not k.startswith("_")}

        if rc != 0:
            if target_dir.exists():
                shutil.rmtree(target_dir, ignore_errors=True)
            err_msg = " | ".join(errors) or "Git clone failed. Verify the repository URL and network connectivity."
            raise ValueError(f"Git clone failed: {err_msg}")

        yield {"stage": "ingesting", "percent": 96, "detail": "Indexing repository metadata for dynamic agent analysis..."}
        meta = self.extract_repo_metadata(target_dir, safe_name)
        meta["local_path"] = str(target_dir)
        yield {
            "stage": "completed",
            "percent": 100,
            "detail": f"Cloned '{safe_name}' ({meta.get('commit_count', 0)} commits ready for analysis).",
            "metadata": meta,
        }

    def analyze_repository_commits(
        self,
        local_path: str,
        branch: str = "",
        limit: int = 1000,
    ) -> dict[str, Any]:
        """
        Analyzes the last `limit` git commits in `local_path`:
        - Parses conventional commit types (feat, fix, refactor, perf, docs, test, chore)
        - Computes lines added/deleted, file counts, and contribution scores per author
        - Computes commit timeline (daily/weekly velocity) and top directories/file extensions
        - Syncs the analyzed commits into DuckDB (`github_commits` and `github_contributors`)
        """
        target_dir = self.resolve_repo_dir(local_path)
        if not self.is_repo_cloned(str(target_dir)):
            raise ValueError(f"Path '{local_path}' is not a valid git repository.")

        safe_name = self.sanitize_repo_name(target_dir.name)

        log_args = [
            "log",
            "-n",
            str(limit),
            "--numstat",
            "--date=iso-strict",
            "--pretty=format:COMMIT_RECORD%x1f%H%x1f%an%x1f%ae%x1f%ad%x1f%s",
        ]
        if branch and branch not in ("HEAD", "auto"):
            log_args.append(branch)

        rc, stdout, _ = self._run_git(log_args, cwd=target_dir, timeout=90)
        if rc != 0 or not stdout:
            rc, stdout, _ = self._run_git(
                [
                    "log",
                    "-n",
                    str(limit),
                    "--numstat",
                    "--date=iso-strict",
                    "--pretty=format:COMMIT_RECORD%x1f%H%x1f%an%x1f%ae%x1f%ad%x1f%s",
                ],
                cwd=target_dir,
                timeout=90,
            )

        author_map: dict[str, dict[str, Any]] = defaultdict(
            lambda: {
                "author": "",
                "total": 0,
                "lines_added": 0,
                "lines_deleted": 0,
                "files_changed": 0,
                "feat": 0,
                "fix": 0,
                "refactor": 0,
                "perf": 0,
                "docs": 0,
                "test": 0,
                "chore": 0,
                "other": 0,
                "contribution_score": 0,
                "recent_messages": [],
            }
        )
        type_counts: dict[str, int] = defaultdict(int)
        commits_by_date: dict[str, int] = defaultdict(int)
        module_churn: dict[str, dict[str, int]] = defaultdict(lambda: {"commits": 0, "lines_added": 0, "lines_deleted": 0})
        commits_to_ingest: list[dict[str, Any]] = []

        _, current_branch, _ = self._run_git(["rev-parse", "--abbrev-ref", "HEAD"], cwd=target_dir)
        effective_branch = branch or (current_branch if current_branch and current_branch != "HEAD" else "main")

        current_commit: dict[str, Any] | None = None
        for raw_line in stdout.split("\n"):
            line = raw_line.strip()
            if not line:
                continue
            if line.startswith("COMMIT_RECORD\x1f"):
                if current_commit:
                    commits_to_ingest.append(current_commit)
                parts = line.split("\x1f")
                c_sha = parts[1] if len(parts) > 1 else ""
                author = (parts[2] if len(parts) > 2 else "Unknown").strip() or "Unknown"
                email = (parts[3] if len(parts) > 3 else "").strip()
                c_date = parts[4] if len(parts) > 4 else "2026-01-01T00:00:00"
                msg = (parts[5] if len(parts) > 5 else "").strip()

                ctype, weight = classify_commit_message(msg)
                type_counts[ctype] += 1
                day_key = c_date[:10]
                commits_by_date[day_key] += 1

                entry = author_map[author]
                entry["author"] = author
                entry["total"] += 1
                entry[ctype] += 1
                entry["contribution_score"] += weight
                if len(entry["recent_messages"]) < 3:
                    entry["recent_messages"].append(msg)

                current_commit = {
                    "commit_id": c_sha[:10],
                    "author": author,
                    "author_email": email,
                    "repo": safe_name,
                    "branch": effective_branch,
                    "commit_type": ctype,
                    "impact_weight": weight,
                    "files_changed": 0,
                    "message": msg,
                    "lines_added": 0,
                    "lines_deleted": 0,
                    "committed_at": c_date[:19].replace("T", " "),
                }
            elif current_commit and "\t" in line:
                stat_parts = line.split("\t")
                if len(stat_parts) >= 3:
                    added = int(stat_parts[0]) if stat_parts[0].isdigit() else 0
                    deleted = int(stat_parts[1]) if stat_parts[1].isdigit() else 0
                    file_path = stat_parts[2].strip()
                    current_commit["lines_added"] += added
                    current_commit["lines_deleted"] += deleted
                    current_commit["files_changed"] += 1

                    author_entry = author_map[current_commit["author"]]
                    author_entry["lines_added"] += added
                    author_entry["lines_deleted"] += deleted
                    author_entry["files_changed"] += 1

                    top_mod = file_path.split("/")[0] if "/" in file_path else "(root)"
                    module_churn[top_mod]["commits"] += 1
                    module_churn[top_mod]["lines_added"] += added
                    module_churn[top_mod]["lines_deleted"] += deleted

        if current_commit:
            commits_to_ingest.append(current_commit)

        sorted_authors = sorted(author_map.values(), key=lambda x: (x["contribution_score"], x["lines_added"]), reverse=True)
        sorted_modules = [
            {"module": mod, **stats, "total_churn": stats["lines_added"] + stats["lines_deleted"]}
            for mod, stats in sorted(
                module_churn.items(),
                key=lambda item: item[1]["lines_added"] + item[1]["lines_deleted"],
                reverse=True,
            )[:15]
        ]

        # Also inspect tracked files composition via git ls-tree
        file_extensions: dict[str, int] = defaultdict(int)
        rc_ls, ls_out, _ = self._run_git(["ls-tree", "-r", "--name-only", "HEAD"], cwd=target_dir, timeout=30)
        total_tracked_files = 0
        if rc_ls == 0 and ls_out:
            for f_line in ls_out.split("\n"):
                f_line = f_line.strip()
                if not f_line:
                    continue
                total_tracked_files += 1
                ext = Path(f_line).suffix.lower() or "(no-ext)"
                file_extensions[ext] += 1

        top_extensions = [
            {"extension": ext, "file_count": cnt}
            for ext, cnt in sorted(file_extensions.items(), key=lambda x: x[1], reverse=True)[:12]
        ]

        return {
            "repo_name": safe_name,
            "local_path": str(target_dir),
            "branch": effective_branch,
            "total_commits": len(commits_to_ingest),
            "total_tracked_files": total_tracked_files,
            "type_counts": dict(type_counts),
            "top_committers": sorted_authors[:15],
            "top_modules_by_churn": sorted_modules,
            "top_file_extensions": top_extensions,
            "daily_commit_velocity": [
                {"date": d, "commits": cnt}
                for d, cnt in sorted(commits_by_date.items())[-30:]
            ],
        }

    def extract_custom_repository_records(
        self,
        local_path: str,
        mode: str = "features_and_modules",
        path_filter: str = "",
        search_pattern: str = "",
        limit: int = 150,
    ) -> dict[str, Any]:
        """
        Dynamically extracts structured records from a cloned Git repository based on the analytical question.
        Modes:
        - 'features_and_modules': Extracts features, routes/endpoints, UI components, classes, and modules with primary author, contributor count, commit count, and LOC.
        - 'issues_todos_and_fixes': Extracts in-code TODO/FIXME/BUG/HACK items and bugfix/issue commits with author, date, severity/tag, and file/module.
        - 'file_ownership_and_churn': Extracts per-file and per-module authorship, churn, contributor counts, and last modified dates.
        - 'git_search': Searches git history by commit message/diff pattern or path filter and returns matching structured records.
        """
        target_dir = self.resolve_repo_dir(local_path)
        if not self.is_repo_cloned(str(target_dir)):
            raise ValueError(f"Path '{local_path}' is not a valid git repository.")

        safe_name = self.sanitize_repo_name(target_dir.name)
        is_bare = (target_dir / "HEAD").is_file() and not (target_dir / ".git").exists()
        max_rows = max(10, min(int(limit or 150), 1000))
        norm_mode = (mode or "features_and_modules").strip().lower()
        clean_path_filter = path_filter.strip().lstrip("/")
        clean_search = search_pattern.strip()

        # Build fast file authorship & churn lookup from git log in a single pass
        file_stats: dict[str, dict[str, Any]] = {}
        author_counts_by_file: dict[str, dict[str, int]] = defaultdict(lambda: defaultdict(int))
        log_cmd = [
            "log",
            "-n",
            "500",
            "--numstat",
            "--date=short",
            "--pretty=format:COMMIT_META%x1f%H%x1f%an%x1f%ae%x1f%ad%x1f%s",
        ]
        if clean_path_filter:
            log_cmd.extend(["--", clean_path_filter])
        _, log_out, _ = self._run_git(log_cmd, cwd=target_dir, timeout=60)

        cur_meta: dict[str, str] | None = None
        parsed_commits: list[dict[str, Any]] = []
        cur_commit_obj: dict[str, Any] | None = None

        if log_out:
            for raw_line in log_out.split("\n"):
                line = raw_line.strip()
                if not line:
                    continue
                if line.startswith("COMMIT_META\x1f"):
                    if cur_commit_obj:
                        parsed_commits.append(cur_commit_obj)
                    parts = line.split("\x1f")
                    c_hash = (parts[1] if len(parts) > 1 else "")[:10]
                    c_author = (parts[2] if len(parts) > 2 else "Unknown").strip() or "Unknown"
                    c_email = (parts[3] if len(parts) > 3 else "").strip()
                    c_date = (parts[4] if len(parts) > 4 else "").strip()
                    c_subj = (parts[5] if len(parts) > 5 else "").strip()
                    ctype, _ = classify_commit_message(c_subj)
                    cur_meta = {
                        "hash": c_hash,
                        "author": c_author,
                        "email": c_email,
                        "date": c_date,
                        "subject": c_subj,
                        "commit_type": ctype,
                    }
                    cur_commit_obj = {
                        **cur_meta,
                        "files_changed": 0,
                        "lines_added": 0,
                        "lines_deleted": 0,
                        "files": [],
                    }
                elif cur_meta and "\t" in line:
                    sp = line.split("\t")
                    if len(sp) >= 3:
                        add_v = int(sp[0]) if sp[0].isdigit() else 0
                        del_v = int(sp[1]) if sp[1].isdigit() else 0
                        fpath = sp[2].strip()
                        if cur_commit_obj is not None:
                            cur_commit_obj["files_changed"] += 1
                            cur_commit_obj["lines_added"] += add_v
                            cur_commit_obj["lines_deleted"] += del_v
                            if len(cur_commit_obj["files"]) < 5:
                                cur_commit_obj["files"].append(fpath)

                        author_counts_by_file[fpath][cur_meta["author"]] += 1
                        if fpath not in file_stats:
                            file_stats[fpath] = {
                                "file_path": fpath,
                                "last_author": cur_meta["author"],
                                "author_email": cur_meta["email"],
                                "last_modified": cur_meta["date"],
                                "last_commit": cur_meta["subject"][:120],
                                "commits": 0,
                                "lines_added": 0,
                                "lines_deleted": 0,
                            }
                        file_stats[fpath]["commits"] += 1
                        file_stats[fpath]["lines_added"] += add_v
                        file_stats[fpath]["lines_deleted"] += del_v
            if cur_commit_obj:
                parsed_commits.append(cur_commit_obj)

        def get_primary_owner(fpath: str) -> tuple[str, int]:
            ac = author_counts_by_file.get(fpath)
            if not ac:
                st = file_stats.get(fpath, {})
                return st.get("last_author", "Unknown"), 1
            top_author = max(ac.items(), key=lambda x: x[1])[0]
            return top_author, len(ac)

        def read_repo_file_text(rel_path: str) -> str:
            if not is_bare:
                fp = target_dir / rel_path
                if fp.exists() and fp.is_file() and fp.stat().st_size <= 350_000:
                    return fp.read_text(encoding="utf-8", errors="replace")
                return ""
            rc_s, out_s, _ = self._run_git(["show", f"HEAD:{rel_path}"], cwd=target_dir, timeout=10)
            return out_s if rc_s == 0 else ""

        # List tracked files
        _, ls_out, _ = self._run_git(["ls-tree", "-r", "--name-only", "HEAD"], cwd=target_dir, timeout=30)
        tracked_files = [f.strip() for f in (ls_out or "").split("\n") if f.strip()]
        if clean_path_filter:
            tracked_files = [f for f in tracked_files if f.startswith(clean_path_filter)]

        code_exts = {".py", ".ts", ".tsx", ".js", ".jsx", ".go", ".rs", ".java", ".rb", ".cs", ".cpp", ".c", ".vue", ".svelte"}
        records: list[dict[str, Any]] = []

        if norm_mode in ("features", "features_and_modules", "components", "architecture"):
            symbol_re = re.compile(
                r"^(?:\s*export\s+(?:default\s+)?(?:async\s+)?(?:function|const|class|interface)\s+([A-Za-z0-9_]+)"
                r"|\s*(?:async\s+)?def\s+([A-Za-z0-9_]+)\s*\("
                r"|\s*class\s+([A-Za-z0-9_]+)\b"
                r"|\s*@(?:router|app)\.(?:get|post|put|delete|patch)\(\s*['\"]([^'\"]+)['\"])"
            )
            code_files = [f for f in tracked_files if Path(f).suffix.lower() in code_exts]
            # Prioritize files with higher activity
            code_files.sort(key=lambda f: file_stats.get(f, {}).get("commits", 0), reverse=True)

            for rel_f in code_files[: min(160, len(code_files))]:
                content = read_repo_file_text(rel_f)
                if not content:
                    continue
                lines = content.splitlines()
                loc = len(lines)
                primary_author, contrib_count = get_primary_owner(rel_f)
                st = file_stats.get(rel_f, {})
                parts = rel_f.split("/")
                module_name = "/".join(parts[:2]) if len(parts) > 2 else (parts[0] if len(parts) > 1 else "root")

                extracted_in_file = 0
                for line in lines:
                    m = symbol_re.match(line)
                    if not m:
                        continue
                    sym_name = m.group(1) or m.group(2) or m.group(3) or m.group(4)
                    if not sym_name or sym_name.startswith("_") or sym_name in ("main", "init", "constructor", "render"):
                        continue
                    if clean_search and clean_search.lower() not in sym_name.lower() and clean_search.lower() not in rel_f.lower():
                        continue

                    if m.group(4):
                        category = "API Route / Endpoint"
                    elif rel_f.endswith((".tsx", ".jsx", ".vue", ".svelte")) and sym_name[0].isupper():
                        category = "UI Component / View"
                    elif m.group(3) or (sym_name[0].isupper() and not sym_name.isupper()):
                        category = "Class / Service"
                    else:
                        category = "Feature / Function"

                    records.append({
                        "repo": safe_name,
                        "feature_name": sym_name,
                        "category": category,
                        "module": module_name,
                        "file_path": rel_f,
                        "primary_author": primary_author,
                        "last_author": st.get("last_author", primary_author),
                        "contributor_count": contrib_count,
                        "commits_on_file": st.get("commits", 1),
                        "file_loc": loc,
                        "last_modified": st.get("last_modified", ""),
                        "last_commit_summary": st.get("last_commit", ""),
                    })
                    extracted_in_file += 1
                    if extracted_in_file >= 4 or len(records) >= max_rows:
                        break
                if len(records) >= max_rows:
                    break

            # Also include feature commits if fewer records or if requested
            if len(records) < max_rows:
                for c in parsed_commits:
                    if c["commit_type"] == "feat":
                        if clean_search and clean_search.lower() not in c["subject"].lower():
                            continue
                        first_file = c["files"][0] if c["files"] else "(multiple)"
                        mod = first_file.split("/")[0] if "/" in first_file else "root"
                        records.append({
                            "repo": safe_name,
                            "feature_name": c["subject"][:90],
                            "category": "Feature Commit (feat)",
                            "module": mod,
                            "file_path": first_file,
                            "primary_author": c["author"],
                            "last_author": c["author"],
                            "contributor_count": 1,
                            "commits_on_file": 1,
                            "file_loc": c["lines_added"],
                            "last_modified": c["date"],
                            "last_commit_summary": c["subject"][:120],
                        })
                        if len(records) >= max_rows:
                            break

        elif norm_mode in ("issues", "issues_todos_and_fixes", "todos", "bugs"):
            todo_re = re.compile(r"\b(TODO|FIXME|BUG|HACK|XXX|DEPRECATED)\b[:\s-]*(.*)", re.IGNORECASE)
            code_files = [f for f in tracked_files if Path(f).suffix.lower() in code_exts]
            for rel_f in code_files[: min(200, len(code_files))]:
                content = read_repo_file_text(rel_f)
                if not content:
                    continue
                primary_author, _ = get_primary_owner(rel_f)
                st = file_stats.get(rel_f, {})
                mod = rel_f.split("/")[0] if "/" in rel_f else "root"
                for idx, line in enumerate(content.splitlines(), start=1):
                    m = todo_re.search(line)
                    if m:
                        tag = m.group(1).upper()
                        detail = m.group(2).strip()[:140] or line.strip()[:140]
                        if clean_search and clean_search.lower() not in detail.lower() and clean_search.lower() not in rel_f.lower():
                            continue
                        records.append({
                            "repo": safe_name,
                            "issue_kind": f"Code {tag}",
                            "tag": tag,
                            "summary": detail,
                            "module": mod,
                            "file_path": f"{rel_f}:{idx}",
                            "author": primary_author,
                            "date": st.get("last_modified", ""),
                            "commits_or_churn": st.get("commits", 1),
                            "reference": f"L{idx}",
                        })
                        if len(records) >= max_rows // 2:
                            break
                if len(records) >= max_rows // 2:
                    break

            issue_ref_re = re.compile(r"(#\d+|[A-Z]{2,10}-\d+)")
            for c in parsed_commits:
                subj_l = c["subject"].lower()
                ref_m = issue_ref_re.search(c["subject"])
                is_issue_or_fix = (
                    c["commit_type"] == "fix"
                    or ref_m is not None
                    or any(w in subj_l for w in ("fix", "bug", "issue", "hotfix", "resolve", "error", "crash", "patch"))
                )
                if not is_issue_or_fix:
                    continue
                if clean_search and clean_search.lower() not in subj_l:
                    continue
                first_f = c["files"][0] if c["files"] else "(repo)"
                mod = first_f.split("/")[0] if "/" in first_f else "root"
                records.append({
                    "repo": safe_name,
                    "issue_kind": "Issue / Bugfix Commit",
                    "tag": "FIX" if c["commit_type"] == "fix" else "ISSUE",
                    "summary": c["subject"][:140],
                    "module": mod,
                    "file_path": first_f,
                    "author": c["author"],
                    "date": c["date"],
                    "commits_or_churn": c["lines_added"] + c["lines_deleted"],
                    "reference": ref_m.group(1) if ref_m else c["hash"],
                })
                if len(records) >= max_rows:
                    break

        elif norm_mode in ("file_ownership_and_churn", "ownership", "hotspots", "files"):
            sorted_files = sorted(
                file_stats.values(),
                key=lambda x: (x["commits"], x["lines_added"] + x["lines_deleted"]),
                reverse=True,
            )
            for st in sorted_files:
                fpath = st["file_path"]
                if clean_search and clean_search.lower() not in fpath.lower() and clean_search.lower() not in st["last_author"].lower():
                    continue
                primary_author, contrib_count = get_primary_owner(fpath)
                parts = fpath.split("/")
                mod = "/".join(parts[:2]) if len(parts) > 2 else (parts[0] if len(parts) > 1 else "root")
                records.append({
                    "repo": safe_name,
                    "file_path": fpath,
                    "module": mod,
                    "extension": Path(fpath).suffix.lower() or "(no-ext)",
                    "primary_author": primary_author,
                    "last_author": st["last_author"],
                    "contributor_count": contrib_count,
                    "commits": st["commits"],
                    "lines_added": st["lines_added"],
                    "lines_deleted": st["lines_deleted"],
                    "total_churn": st["lines_added"] + st["lines_deleted"],
                    "last_modified": st["last_modified"],
                })
                if len(records) >= max_rows:
                    break

        else:
            # Default / git_search mode: custom search across commits & diffs
            search_args = [
                "log",
                "-n",
                str(max_rows),
                "--numstat",
                "--date=short",
                "--pretty=format:COMMIT_META%x1f%H%x1f%an%x1f%ae%x1f%ad%x1f%s",
            ]
            if clean_search:
                search_args.append(f"--grep={clean_search}")
                search_args.append("-i")
            if clean_path_filter:
                search_args.extend(["--", clean_path_filter])

            _, s_out, _ = self._run_git(search_args, cwd=target_dir, timeout=45)
            # If grep returned nothing and clean_search is provided, try pickaxe -S (code diff search)
            if not s_out and clean_search:
                pickaxe_args = [
                    "log",
                    "-n",
                    str(max_rows),
                    "-S",
                    clean_search,
                    "--numstat",
                    "--date=short",
                    "--pretty=format:COMMIT_META%x1f%H%x1f%ae%x1f%ad%x1f%s",
                ]
                if clean_path_filter:
                    pickaxe_args.extend(["--", clean_path_filter])
                _, s_out, _ = self._run_git(pickaxe_args, cwd=target_dir, timeout=45)

            for c in parsed_commits:
                if clean_search and clean_search.lower() not in c["subject"].lower() and not any(clean_search.lower() in f.lower() for f in c["files"]):
                    continue
                first_f = c["files"][0] if c["files"] else "(repo)"
                mod = first_f.split("/")[0] if "/" in first_f else "root"
                records.append({
                    "repo": safe_name,
                    "commit_hash": c["hash"],
                    "author": c["author"],
                    "author_email": c["email"],
                    "date": c["date"],
                    "commit_type": c["commit_type"],
                    "module": mod,
                    "primary_file": first_f,
                    "files_changed": c["files_changed"],
                    "lines_added": c["lines_added"],
                    "lines_deleted": c["lines_deleted"],
                    "subject": c["subject"][:140],
                })
                if len(records) >= max_rows:
                    break

        columns = list(records[0].keys()) if records else []
        return {
            "repo": safe_name,
            "mode": norm_mode,
            "row_count": len(records),
            "columns": columns,
            "records": records,
        }

    def delete_repository(self, local_path: str) -> bool:
        """Safely removes a repository directory from disk (confined to REPOS_DIR)."""
        target = Path(local_path).resolve()
        repos_root = REPOS_DIR.resolve()

        try:
            target.relative_to(repos_root)
        except ValueError:
            logger.warning(f"Prevented deletion of '{local_path}': path is outside REPOS_DIR ({repos_root}).")
            return False

        if target.exists() and target.is_dir():
            shutil.rmtree(target, ignore_errors=True)
            logger.info(f"Successfully deleted local repository files at {target}.")
            return True
        return False


git_service = GitService()
