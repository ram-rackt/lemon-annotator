"""Copy projects and annotations from the local JSON folder (app_data) into the database.

    cd backend
    .venv\\Scripts\\python -m app.migrate                 # macOS/Linux: .venv/bin/python -m app.migrate
    .venv\\Scripts\\python -m app.migrate --data-dir D:\\old\\app_data

Reads LEMON_DATABASE_URL (environment or backend/.env). The local files are only read, never changed.
Projects whose id already exists in the database are skipped, so running it twice is safe.
"""

import argparse
import sys
from pathlib import Path

from .config import get_settings
from .db_store import DatabaseStore
from .errors import AppError
from .storage import ProjectStore


def migrate(files: ProjectStore, db: DatabaseStore, log=print) -> tuple[int, int]:
    """Returns (projects copied, annotations copied)."""
    projects = annotations = 0
    for project in files.list_projects():
        stored, warnings = files.iter_annotations(project.id)
        # One transaction per project: an interrupted copy leaves nothing behind and is redone next run.
        if not db.import_project(project, stored):
            log(f"skip  {project.id}  (already in the database)")
            continue
        for warning in warnings:
            log(f"      warning: {warning}")
        projects += 1
        annotations += len(stored)
        log(f"copy  {project.id}  ({project.name}): {len(stored)} annotated video(s)")
    return projects, annotations


def main(argv: list[str] | None = None) -> int:
    settings = get_settings()
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--data-dir", type=Path, default=settings.data_dir, help=f"default: {settings.data_dir}")
    args = parser.parse_args(argv)

    if not settings.database_url:
        print("LEMON_DATABASE_URL is not set (put it in backend/.env or the environment).", file=sys.stderr)
        return 1
    if not (args.data_dir / "projects").is_dir():
        print(f"No projects folder in {args.data_dir}.", file=sys.stderr)
        return 1
    try:
        db = DatabaseStore(settings.database_url)
        try:
            projects, annotations = migrate(ProjectStore(args.data_dir), db)
        finally:
            db.close()
    except AppError as exc:
        print(f"Error: {exc.message}" + (f"\n{exc.hint}" if exc.hint else ""), file=sys.stderr)
        return 1
    print(f"\nDone: {projects} project(s), {annotations} annotated video(s) copied.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
