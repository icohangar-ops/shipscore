# Deploy: GitHub + Vercel in 5 minutes

This folder is a git-ready repository. Two paths below — pick one.

---

## Step 1 — GitHub

Push to both mirrors (Team Dash keeps two identical public repos):

- **Canonical:** https://github.com/Cubiczan/shipscore
- **Mirror:** https://github.com/icohangar-ops/shipscore

```bash
git remote add origin   https://github.com/Cubiczan/shipscore.git
git remote add mirror   https://github.com/icohangar-ops/shipscore.git
git push origin main
git push mirror main
```

> The dogfood workflow (`.github/workflows/shipscore-dogfood.yml`) runs automatically on
> the first push — check the Actions tab for the first ShipScore run on this repo.

---

## Step 2 — Deploy to Vercel

### Option A — Dashboard (recommended, zero CLI)

1. Go to https://vercel.com/new
2. **Import** the `shipscore` repo
3. Framework preset: **Next.js** (auto-detected) — leave build settings untouched
4. Click **Deploy**
5. Done — you get `https://shipscore.vercel.app`
   (use this as the Live Demo link on the lablab submission form)

### Option B — CLI

```bash
npm i -g vercel
vercel login
vercel --prod
```

## Notes

- `next.config.ts` intentionally does **not** use `output: "standalone"` — it breaks
  Vercel's node file tracing on Next.js 16 (ENOENT `.next/next-server.js.nft.json`).
- The landing page is fully static — no environment variables required.
- The GitHub Action (`action.yml`) runs on GitHub runners only; it needs no Vercel.
