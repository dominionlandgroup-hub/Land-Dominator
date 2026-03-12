# Deployment Guide: Vercel + Render Free Tier

This guide walks through deploying the Land Parcel Analysis Tool on Vercel (frontend) and Render (backend) using the free tier.

## Architecture Overview

```
┌─────────────────┐         ┌──────────────────┐
│   Vercel        │         │   Render         │
│   (Frontend)    │◄────────┤   (Backend API)  │
│   React/Vite    │  HTTPS  │   FastAPI        │
└─────────────────┘         └──────────────────┘
        ▲                            ▲
        │                            │
        └──────────┬─────────────────┘
                   │
            PostgreSQL DB
           (Render free tier)
```

---

## Part 1: Deploy Backend to Render

### Step 1: Push Code to GitHub

```bash
# Initialize git (if not already done)
git add .
git commit -m "Initial project setup"
git push origin main
```

### Step 2: Create Render Account

1. Go to [https://render.com](https://render.com)
2. Sign up with GitHub (recommended for easy deployments)
3. Authorize Render to access your GitHub account

### Step 3: Deploy Backend Service

1. In Render dashboard, click **+ New +** → **Web Service**
2. Select the GitHub repository: `dominionlandgroup-hub/Land-Dominator`
3. Configure:
   - **Name**: `land-parcel-api`
   - **Environment**: `Python 3`
   - **Region**: Choose closest to you (e.g., `oregon`)
   - **Build Command**: `pip install -r requirements.txt`
   - **Start Command**: `gunicorn -w 4 -k uvicorn.workers.UvicornWorker -b 0.0.0.0:$PORT main:app`
   - **Plan**: Free (shared CPU, 0.5 GB RAM)

4. Add **Environment Variables**:
   ```
   APP_ENV=production
   DATABASE_URL=<postgresql-url-from-render>  # Will configure after DB setup
   MAX_UPLOAD_MB=250
   CORS_ORIGINS=https://<your-vercel-domain>.vercel.app
   PORT=10000
   ```

5. Click **Create Web Service** and wait for deployment (~5 min)

### Step 4: Create PostgreSQL Database (Optional - Free Tier)

1. In Render, click **+ New +** → **PostgreSQL**
2. Configure:
   - **Name**: `land-parcel-db`
   - **Database**: `landparcel`
   - **User**: `postgres`
   - **Region**: Same as backend service
   - **Plan**: Free (0.4 GB storage)

3. Copy the **Internal Database URL** and add to backend environment variables as `DATABASE_URL`

4. Update backend **build command** to include migrations (if using SQLAlchemy):
   ```
   pip install -r requirements.txt && alembic upgrade head
   ```

### Step 5: Note Backend URL

Once deployment completes, note the backend service URL (e.g., `https://land-parcel-api.onrender.com`). You'll need this for the frontend.

---

## Part 2: Deploy Frontend to Vercel

### Step 1: Prepare Frontend for Vercel

Vercel expects a `vercel.json` config file (already created in `/frontend/vercel.json`).

Create `/frontend/.env.production`:
```
VITE_API_BASE_URL=https://land-parcel-api.onrender.com
```

### Step 2: Create Vercel Account

1. Go to [https://vercel.com](https://vercel.com)
2. Sign up with GitHub
3. Authorize Vercel to access your GitHub account

### Step 3: Deploy Frontend

1. In Vercel dashboard, click **Add New...** → **Project**
2. Import the GitHub repository: `dominionlandgroup-hub/Land-Dominator`
3. Configure:
   - **Framework Preset**: `Vite`
   - **Root Directory**: `./frontend`
   - **Build Command**: `npm run build`
   - **Output Directory**: `dist`
   - **Install Command**: `npm ci`

4. Add **Environment Variables**:
   ```
   VITE_API_BASE_URL=https://land-parcel-api.onrender.com
   ```

5. Click **Deploy** and wait (~2-3 min)

6. Once live, note the Vercel URL (e.g., `https://land-parcel.vercel.app`)

### Step 4: Update Backend CORS

Go back to Render, update the backend environment variable:
```
CORS_ORIGINS=https://<your-vercel-domain>.vercel.app
```

Redeploy the backend service using the **Restart** or **Trigger Deploy** button.

---

## Part 3: Verify Deployment

### Frontend Health Check

```bash
curl https://land-parcel.vercel.app
# Should return the React app
```

### Backend Health Check

```bash
curl https://land-parcel-api.onrender.com/health
# Should return:
# {"status": "healthy", "service": "Land Parcel Analysis Tool API"}
```

### API Communication Test

In the frontend, open the browser console and check for any CORS errors when uploading a CSV. If successful, the network request should return a response.

---

## Part 4: Free Tier Limitations & Workarounds

### Render (Backend)
- **CPU**: Shared (0.5 vCPU) - Good for initial testing, may be slow with large datasets
- **Memory**: 0.5 GB - Keep session memory usage minimal
- **Storage**: File-based SQLite is temporary (gets cleared on redeploy)
- **Uptime**: Service spins down after 15 min inactivity (cold start ~30 sec)
- **Max Build Time**: 30 minutes

**Optimization Tips**:
- Use background job queue for large CSV processing (add Celery + Redis later)
- Cache frequently accessed comp data in memory
- Compress CSV uploads before transmission

### Vercel (Frontend)
- **Build Minutes**: 100/month free
- **Bandwidth**: 100 GB/month free
- **Serverless Functions**: 100 executions/day free
- **Cold start**: <1 second (integrated with Vercel infrastructure)

**Optimization Tips**:
- Enable incremental static regeneration (ISR)
- Use image optimization for charts/visualizations
- Lazy load routes

---

## Part 5: Monitoring & Logging

### Render Logs
1. Go to the backend service in Render
2. Navigate to **Logs** tab
3. Monitor for errors in real-time

### Vercel Logs
1. Go to Vercel project dashboard
2. Navigate to **Deployments**
3. Click on any deployment → **Logs**

### Application Metrics
- Use Render's built-in metrics for memory/CPU usage
- Monitor backend response times in browser DevTools

---

## Part 6: Upgrading from Free Tier

When you outgrow free tier limits:

### Backend (Render)
| Feature | Free | Starter | Cost |
|---------|------|---------|------|
| CPU | Shared | Dedicated | $7/mo |
| Memory | 0.5 GB | 1 GB | $7/mo |
| Cold Starts | Yes | No | +$7/mo |
| Database | 0.4 GB | 100 GB+ | $15/mo |

### Frontend (Vercel)
| Feature | Free | Pro | Cost |
|---------|------|-----|------|
| Build Time | 100 min/mo | Unlimited | $20/mo |
| Bandwidth | 100 GB/mo | 500 GB/mo | +$40/mo |
| APIs | Limited | Full | — |

---

## Part 7: CI/CD Updates & Auto-Deploy

### Enable Auto-Deploy on Push

Both Vercel and Render automatically redeploy when you push to `main` branch.

**Local Development Flow**:
```bash
cd <repo>
git checkout -b feature/new-feature
# Make changes
git add .
git commit -m "Add new feature"
git push origin feature/new-feature
# Create Pull Request on GitHub
# Vercel auto-creates preview deployments for PRs
# Merge when ready → Auto-deploys to prod
```

---

## Troubleshooting

### Backend: "Build failed"
- Check `requirements.txt` for syntax errors
- Ensure all dependencies are listed
- Check Render logs for specific error messages

### Frontend: "CORS errors in console"
- Verify `VITE_API_BASE_URL` is set correctly
- Confirm backend's `CORS_ORIGINS` includes the Vercel domain
- Restart backend service after updating CORS

### Slow Performance on Free Tier
- Large CSV processing may timeout (free tier has 30s limit)
- Solution: Implement async uploads + background job processing in Phase 3+

### Database: "Connection refused"
- Verify `DATABASE_URL` is correct in Render env vars
- Check PostgreSQL service is running
- Confirm database name and credentials match

---

## Next Steps

1. Monitor first 24 hours of deployment for stability
2. Create backups of uploaded CSVs (Render has no persistent storage by default)
3. Plan upgrade path to dedicated resources if usage grows
4. Set up error tracking (Sentry) in Phase 2+
5. Add analytics (PostHog) to track user behavior

