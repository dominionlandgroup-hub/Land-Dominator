# Land Parcel Analysis Tool - Setup & Startup Instructions

## Quick Start

Run the automated setup and startup script:

```batch
cd d:\upwork\Land_Parcel
setup_and_start.bat
```

This will:
1. ✓ Create Python virtual environment (if needed)
2. ✓ Install backend dependencies (FastAPI, Uvicorn, Pandas, etc.)
3. ✓ Install frontend dependencies (React, Vite, TypeScript, Tailwind)
4. ✓ Start backend server on port 8000
5. ✓ Start frontend dev server on port 3000

---

## Manual Setup (if needed)

### Backend Setup
```batch
cd d:\upwork\Land_Parcel\backend
python -m venv venv
call venv\Scripts\activate.bat
python -m pip install --upgrade pip
pip install -r requirements.txt
python -m uvicorn main:app --host 0.0.0.0 --port 8000 --reload
```

### Frontend Setup (in a separate terminal)
```batch
cd d:\upwork\Land_Parcel\frontend
npm ci
npm run dev
```

---

## Access Points

- **Frontend**: http://localhost:3000
- **Backend API**: http://localhost:8000
- **API Documentation**: http://localhost:8000/docs
- **Health Check**: http://localhost:8000/health

---

## Project Structure

```
Land_Parcel/
├── backend/           # FastAPI application
│   ├── main.py       # Entry point
│   ├── routers/      # API routes
│   ├── services/     # Business logic
│   ├── models/       # Data models
│   ├── venv/         # Python virtual environment
│   └── requirements.txt
├── frontend/         # React + Vite application
│   ├── src/          # React components
│   ├── node_modules/ # NPM dependencies
│   ├── package.json
│   └── tsconfig.json
└── setup_and_start.bat # Automated setup script
```

---

## Features

### Backend (FastAPI)
- **Upload**: CSV file upload for sold comps and target parcels
- **Dashboard**: Analytics and reporting
- **Matching**: Property matching algorithms
- **Mailing**: Mail list generation
- **Campaigns**: Campaign management

### Frontend (React + Vite)
- **React 18** with TypeScript
- **Vite** for fast development
- **Tailwind CSS** for styling
- **React Router** for navigation
- **Recharts** for data visualization
- **Axios** for API calls

---

## Environment Configuration

Backend environment file (`.env`):
- `APP_ENV=development`
- `APP_NAME=Land Parcel Analysis Tool`
- `DEBUG=True`
- `MAX_UPLOAD_MB=300`
- `CORS_ORIGINS=http://localhost:3000,http://localhost:5173`
- `PORT=8000`

---

## Stopping Servers

Simply close the terminal windows where the servers are running.

---

## Troubleshooting

### Backend won't start
- Ensure Python 3.9+ is installed: `python --version`
- Try manually reinstalling: `pip install --upgrade -r requirements.txt`

### Frontend won't start
- Ensure Node.js 16+ is installed: `node --version`
- Try clean install: `npm ci` or `rm -r node_modules && npm install`

### Port conflicts
- Backend uses port 8000
- Frontend uses port 3000
- Ensure these ports are available

---

## Additional Notes

- Hot reload is enabled for both backend and frontend
- Check `.env` file for configuration changes
- Data storage location: `backend/storage/`
