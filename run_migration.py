"""
Run CRM migrations against Supabase.

Usage — TWO options:

Option A (Supabase Dashboard — easiest):
  1. Open https://supabase.com/dashboard/project/pjhwgnhtiovshoulpgeh/sql
  2. Click "New Query"
  3. Paste the contents of supabase_migration.sql
  4. Click "Run"

Option B (This script with DB URL):
  1. Get your database password from:
       Supabase Dashboard → Settings → Database → Connection String
  2. Set the env var and run:
       export DB_URL="postgresql://postgres:[PASSWORD]@db.pjhwgnhtiovshoulpgeh.supabase.co:5432/postgres"
       python3 run_migration.py
"""
import os
import re
import sys


def split_statements(sql: str) -> list[str]:
    sql = re.sub(r'--[^\n]*', '', sql)
    statements, current, in_dollar = [], [], False
    for line in sql.split('\n'):
        stripped = line.strip()
        if stripped.count('$$') % 2 == 1:
            in_dollar = not in_dollar
        current.append(line)
        if not in_dollar and stripped.endswith(';'):
            stmt = '\n'.join(current).strip()
            if stmt and stmt != ';':
                statements.append(stmt)
            current = []
    remaining = '\n'.join(current).strip()
    if remaining:
        statements.append(remaining)
    return [s for s in statements if s.strip() and s.strip() != ';']


if __name__ == "__main__":
    db_url = os.environ.get("DB_URL")
    if not db_url:
        print(__doc__)
        sys.exit(0)

    try:
        import psycopg2
    except ImportError:
        print("Installing psycopg2-binary...")
        os.system("pip3 install psycopg2-binary")
        import psycopg2

    sql_file = os.path.join(os.path.dirname(__file__), "supabase_migration.sql")
    with open(sql_file) as f:
        sql = f.read()

    statements = split_statements(sql)
    print(f"Executing {len(statements)} SQL statements...\n")

    conn = psycopg2.connect(db_url)
    conn.autocommit = True
    cur = conn.cursor()

    success = skipped = 0
    for i, stmt in enumerate(statements, 1):
        preview = stmt[:80].replace('\n', ' ')
        try:
            cur.execute(stmt)
            print(f"[{i:2d}] OK  — {preview}")
            success += 1
        except Exception as e:
            err = str(e).strip()
            if "already exists" in err:
                print(f"[{i:2d}] SKIP (already exists) — {preview}")
                skipped += 1
            else:
                print(f"[{i:2d}] ERR — {preview}\n     {err[:120]}")

    cur.close()
    conn.close()
    print(f"\nDone: {success} executed, {skipped} skipped (already exist)")
