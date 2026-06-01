# Booking MVP — Deployment

## Long-term presentation link — GitHub Pages

Stable URL:

**https://codedevsys.github.io/Booking-v1/**

| Page | URL |
|------|-----|
| Booking | https://codedevsys.github.io/Booking-v1/ |
| Admin | https://codedevsys.github.io/Booking-v1/admin.html |

This repository includes a GitHub Actions workflow:

`Deploy presentation site to GitHub Pages`

After this branch is merged into `main`, make sure GitHub Pages is configured:

1. GitHub repo → **Settings** → **Pages**
2. **Build and deployment** → **Source** = `GitHub Actions`
3. Run the workflow manually, or push to `main`

GitHub Pages is a static presentation deployment. Without a connected backend,
appointments are saved locally in the visitor's browser as demo data.

## Live backend (Render)

**https://booking-mvp.onrender.com**

| Page | URL |
|------|-----|
| Booking | https://booking-mvp.onrender.com/ |
| Admin | https://booking-mvp.onrender.com/admin.html |

Default admin login:

- Username: `admin` (set env `ADMIN_USER` on Render to change)
- Password: `123456` (set env `ADMIN_KEY` on Render to change)

Pushes to branch **`main`** auto-deploy if the Render service is linked to this repo.

**Render dashboard:** https://dashboard.render.com — service name `booking-mvp`

### If the site shows “Cannot GET /”

1. Render → your service → **Environment**
2. Delete variable **`NETLIFY`** if it exists
3. Add **`SERVE_STATIC`** = `true` (optional, default on)
4. **Manual Deploy** → Deploy latest commit

## Local development

```bash
npm install
npm run dev
```

Open http://localhost:3000

## Netlify

`netlify.toml` serves static files from the repo root; `/api/*` uses serverless functions.

> **Important:** `https://booking-mvp.netlify.app` is **not** this project (it shows a different “Shuttle” app). Either reconnect Netlify to `CodeDevSys/booking-mvp` or use **Render** above.

## NEXORA marketing site

Separate project — see branch `nexora-landing` or repo `nexora-landing`.
