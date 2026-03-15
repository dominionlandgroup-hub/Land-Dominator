"""
Land Parcel Analysis Tool - Auto Setup and Start
Run this with: python start_project.py
"""
import subprocess
import sys
import os
import time

ROOT = os.path.dirname(os.path.abspath(__file__))
BACKEND = os.path.join(ROOT, "backend")
FRONTEND = os.path.join(ROOT, "frontend")

venv_python = os.path.join(BACKEND, "venv", "Scripts", "python.exe")

def run(cmd, cwd=None, check=True):
    print(f"  >> {cmd}")
    result = subprocess.run(cmd, shell=True, cwd=cwd)
    if check and result.returncode != 0:
        print(f"\nERROR. Fix the error above and re-run.")
        input("Press Enter to exit...")
        sys.exit(1)

print("=" * 50)
print("  Land Parcel Analysis Tool - Starting Up")
print("=" * 50)

# Step 1: Create venv if missing
if not os.path.exists(venv_python):
    print("\n[1] Creating virtual environment...")
    run(f'"{sys.executable}" -m venv venv', cwd=BACKEND)
else:
    print("\n[1] venv OK")

# Step 2: Install Python deps using venv python (avoids pip.exe issues)
print("\n[2] Installing Python dependencies...")
run(f'"{venv_python}" -m pip install -r requirements.txt -q', cwd=BACKEND)
print("  OK")

# Step 3: Install Node deps if missing
if not os.path.exists(os.path.join(FRONTEND, "node_modules")):
    print("\n[3] Installing Node dependencies...")
    run("npm install", cwd=FRONTEND)
else:
    print("\n[3] node_modules OK")

# Step 4: Start servers in new windows
print("\n[4] Starting servers...")

venv_uvicorn = os.path.join(BACKEND, "venv", "Scripts", "uvicorn.exe")
subprocess.Popen(
    f'start "Backend :8000" cmd /k ""{venv_uvicorn}" main:app --host 0.0.0.0 --port 8000 --reload"',
    shell=True, cwd=BACKEND
)
time.sleep(2)
subprocess.Popen(
    'start "Frontend :3000" cmd /k "npm run dev"',
    shell=True, cwd=FRONTEND
)

print()
print("=" * 50)
print("  Frontend : http://localhost:3000")
print("  Backend  : http://localhost:8000/docs")
print("  Open browser in ~10 seconds")
print("=" * 50)
input("\nPress Enter to close...")
