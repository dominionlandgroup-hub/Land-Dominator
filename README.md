# Land Parcel Analysis Tool

[![Frontend on Vercel](https://img.shields.io/badge/Vercel-Deployed-success?logo=vercel)](https://vercel.com)
[![Backend on Render](https://img.shields.io/badge/Render-Deployed-success?logo=render)](https://render.com)

A modern web platform for land investors to analyze sold comp patterns, match target parcels, and generate AI-informed mailing lists with suggested offer pricing.

**Status**: Under active development (7-day execution roadmap)  
**Budget**: $1,000 USD  
**Timeline**: March 13–20, 2026

## Quick Links

- **Live Frontend**: [https://land-parcel.vercel.app](https://land-parcel.vercel.app) *(Ready to deploy)*
- **Live Backend API**: [https://land-parcel-api.onrender.com](https://land-parcel-api.onrender.com) *(Ready to deploy)*
- **Deployment Guide**: [docs/DEPLOYMENT_VERCEL_RENDER.md](docs/DEPLOYMENT_VERCEL_RENDER.md)
- **Roadmap**: See Phase 1–5 below

---

## Features (Planned)

### Phase 1: Data Ingestion & Validation ✓ (Scaffolding Complete)
- Upload sold comps CSV (Land Portal export)
- Upload target parcels CSV
- Data validation with error reporting
- Data preview (first 20 rows)

### Phase 2: Analytics Dashboard (In Progress)
- ZIP code performance metrics
- Lot size distribution by range
- Price band analysis
- Interactive filters and drill-down

### Phase 3: Matching Engine (Planned)
- Haversine distance-based radius filtering
- Acreage similarity scoring
- Price band alignment
- Parcel characteristic matching
- Explainable match scores (0–5 scale)

### Phase 4: Offer Pricing & Deduplication (Planned)
- Comp-derived offer pricing model
- Low/Medium/High offer bands per parcel
- Parcel-level deduplication (APN)
- Owner-level deduplication
- Campaign labeling and session management
- Mail-ready CSV export

### Phase 5: Hardening & Delivery (Planned)
- End-to-end testing with real data
- Performance optimization (5k–50k rows)
- Edge-case handling (missing coords, sparse data)
- UI polish and error handling
- Full source code delivery

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                         Frontend (Vercel)                       │
│  React 18 + TypeScript + Vite | Recharts | Axios               │
│  - Upload interface                                             │
│  - Analytics dashboard                                          │
│  - Matching results & export                                    │
└──────────────────────────┬──────────────────────────────────────┘
                           │ HTTPS
                           ▼
┌─────────────────────────────────────────────────────────────────┐
│                      Backend API (Render)                       │
│  FastAPI | Python 3.11 | Gunicorn                               │
│  - CSV parsing & validation                                     │
│  - ZIP analytics engine                                         │
│  - Pattern profiler                                             │
│  - Matching engine (Haversine)                                  │
│  - Offer pricing logic                                          │
│  - Deduplication pipeline                                       │
└──────────────────────────┬──────────────────────────────────────┘
                           │
                           ▼
    ┌───────────────────────────────────────────┐
    │   Database (Render PostgreSQL Free Tier)  │
    │   - Campaign metadata                     │
    │   - Session management                    │
    │   - Audit trail                           │
    └───────────────────────────────────────────┘
```

---

## Tech Stack

| Layer | Technology | Notes |
|-------|-----------|-------|
| **Frontend** | React 18, TypeScript, Vite, Recharts | Modern, fast, type-safe |
| **Backend** | FastAPI, Python 3.11, Gunicorn | Async, production-ready |
| **Data Processing** | pandas, numpy | Fast CSV handling |
| **Geospatial** | Haversine (core), optional GeoPandas | Lightweight, no server overhead |
| **Database** | PostgreSQL (also SQLite for dev) | Session & campaign data |
| **Deployment** | Vercel (frontend), Render (backend) | Free tier, auto-scaling |
| **Hosting** | Docker ready | Can migrate to any cloud |

---

## Getting Started

### Prerequisites

- Python 3.11+
- Node.js 20+
- Git
- Docker (optional)

### Local Development Setup

#### 1. Clone & Navigate

```bash
git clone https://github.com/dominionlandgroup-hub/Land-Dominator.git
cd Land-Dominator
```

#### 2. Backend Setup

```bash
cd backend

# Create virtual environment
python -m venv venv
source venv/bin/activate  # On Windows: venv\Scripts\activate

# Install dependencies
pip install -r requirements.txt

# Create .env file
cp .env.example .env

# Run backend
python main.py
# Backend runs on http://localhost:8000
```

**Backend endpoints:**
- `GET /health` — Health check
- `GET /` — Root info
- `GET /docs` — Interactive API docs (Swagger UI)

#### 3. Frontend Setup

```bash
cd ../frontend

# Install dependencies
npm ci

# Create .env file
cp .env.example .env

# Run dev server
npm run dev
# Frontend runs on http://localhost:5173
```

**Environment variables (default for local):**
```
VITE_API_BASE_URL=http://localhost:8000
```

#### 4. Verify Setup

- Frontend: [http://localhost:5173](http://localhost:5173)
- Backend API: [http://localhost:8000/docs](http://localhost:8000/docs)
- Both should communicate without errors

---

## Deployment

### One-Click Deploy to Vercel & Render

Follow the detailed guide: **[docs/DEPLOYMENT_VERCEL_RENDER.md](docs/DEPLOYMENT_VERCEL_RENDER.md)**

**Quick summary:**
1. Push code to GitHub (main branch)
2. Connect Render to GitHub → Deploy backend
3. Connect Vercel to GitHub → Deploy frontend
4. Update CORS settings
5. Done! ~5 minutes total

---

## Project Structure

```
Land-Dominator/
├── .git/                          # Git repository
├── .gitignore                     # Git ignore rules
├── docker-compose.yml             # Local Docker orchestration
├── Dockerfile.backend             # Backend container
├── Dockerfile.frontend            # Frontend container
│
├── backend/                       # FastAPI application
│   ├── main.py                    # Entry point
│   ├── requirements.txt           # Python dependencies
│   ├── .env.example               # Environment template
│   ├── Procfile                   # Render/Heroku config
│   └── render.yaml                # Render native config (future)
│
├── frontend/                      # React application
│   ├── package.json               # Node dependencies
│   ├── vite.config.ts             # Vite configuration
│   ├── tsconfig.json              # TypeScript config
│   ├── vercel.json                # Vercel config
│   ├── .env.example               # Environment template
│   ├── .eslintrc.json             # Lint rules
│   └── src/                       # React source (to be added)
│
├── data-samples/                  # Example CSV files
│   ├── brunswick_solds.csv        # Example sold comps
│   └── brunswick_targets.csv      # Example target parcels
│
├── docs/                          # Documentation
│   ├── DEPLOYMENT_VERCEL_RENDER.md # Detailed deploy guide
│   ├── API.md                     # API specifications (to be added)
│   └── ARCHITECTURE.md            # System design (to be added)
│
└── README.md                      # This file
```

---

## 7-Day Execution Roadmap

| Day | Phase | Focus |
|-----|-------|-------|
| 1 | Phase 1 | Project setup + CSV parsing + data validation |
| 2 | Phase 2 | ZIP code analytics dashboard + visual charts |
| 3 | Phase 2 | Pattern detection engine + profile generation |
| 4 | Phase 3 | Target matching engine + Haversine filtering |
| 5 | Phase 4 | Offer pricing + deduplication logic |
| 6 | Phase 4 | Campaign labeling + session management |
| 7 | Phase 5 | QA, testing, polishing, and delivery |

**Daily updates**: Screenshots + feature demos posted to Upwork every day.

---

## What Makes This 1000x Better Than the Free Prototype

1. ✓ **Correct Data Mapping** — No silent `None` fields; strict schema validation
2. ✓ **Explainable Scoring** — Users see exactly why each parcel matched (0–5 score breakdown)
3. ✓ **Strong Deduplication** — Both parcel-level (APN) and owner-level (mailing address)
4. ✓ **Robust Pricing** — Low/Mid/High offer bands, not single-guess pricing
5. ✓ **Campaign Management** — Save, label, and re-run analyses anytime
6. ✓ **Data Quality Reporting** — Diagnostics before matching runs
7. ✓ **Professional UX** — Guided flow, sensible defaults, clear errors, fast exports
8. ✓ **Production Performance** — Handles 5k–50k row CSVs without slowdown
9. ✓ **Audit Trail** — Every run logged with settings for reproducibility
10. ✓ **Enterprise Ready** — Tested, logged, containerized, deployable anywhere

---

## Critical Requirements From Client

### Already Provided
- ✓ Sold comps CSV (Brunswick County, NC Solds_873)
- ✓ Use case clarity and prioritization
- ✓ Budget ($1,000) and timeline (7 days)
- ✓ GitHub repository access
- ✓ Deployment preference (Vercel + Render free tier)

### Still Needed (Request from Damien)

1. **Target Parcels CSV** — At least 500 rows from Land Portal export
2. **Column Dictionary** — Field names, types, and business rules for both CSVs
3. **Output Examples** — 2–3 rows showing desired final mailing list format
4. **Deduplication Rules** — By APN only, or by owner + mailing address too?
5. **Pricing Logic** — Median price/acre, weighted comps, or both?
6. **Radius Default** — Preferred matching distance (2, 5, or 10 miles?)
7. **Parcel Characteristics** — Which fields are mandatory for matching? (flood, zoning, etc.)
8. **Output Columns** — Exact list of fields needed in final export

---

## Troubleshooting

### Local Development Issues

**Backend won't start:**
```bash
cd backend
pip install -r requirements.txt
python main.py
```

**Frontend won't start:**
```bash
cd frontend
npm ci
npm run dev
```

**Port already in use:**
```bash
# Change port in vite.config.ts or backend main.py
# Frontend: edit vite.config.ts server.port
# Backend: set PORT env var or pass --port to uvicorn
```

**CORS errors:**
- Ensure `CORS_ORIGINS` in backend `.env` includes frontend URL
- Restart backend after changing env vars

### Deployment Troubleshooting

See [docs/DEPLOYMENT_VERCEL_RENDER.md](docs/DEPLOYMENT_VERCEL_RENDER.md#troubleshooting) for detailed solutions.

---

## Development Workflow

1. **Create feature branch**
   ```bash
   git checkout -b feature/component-name
   ```

2. **Make changes**, test locally

3. **Push to GitHub**
   ```bash
   git add .
   git commit -m "Add feature description"
   git push origin feature/component-name
   ```

4. **Create Pull Request** on GitHub

5. **Vercel** auto-creates preview deployment for the PR

6. **Merge to main** → Auto-deploy to production

---

## License

Proprietary. Built for Damien Dupee / Dominion Land Group. All rights reserved.

---

## Support & Contact

- **Developer**: Talha Husnain
  - GitHub: [@talha-husnain](https://github.com/talha-husnain)
  - Portfolio: [talha-husnain-portfolio.netlify.app](https://talha-husnain-portfolio.netlify.app)

- **Client**: Damien Dupee
  - Project Management: Upwork messages (daily updates)

---

**Last Updated**: March 13, 2026  
**Next Milestone**: Phase 1 Complete (Day 1)
