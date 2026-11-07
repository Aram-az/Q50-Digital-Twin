# Browser demo and GitHub Pages deployment

[← README](../README.md) · [Architecture](architecture.md)

## Live demo

**Planned site:** <https://aram-az.github.io/Q50-Digital-Twin/>

This is a static, standalone React application. It has no backend, database, login, device-sensor access or in-car connection. All measurements are deterministic synthetic data generated within the browser. Its fault thresholds are demonstration-only.

Public visitors can launch 15/30/60-second scenarios, select all four MFD presets, inspect simulated overheating and dropout events and replay sessions stored in browser memory. Refreshing clears the in-memory session archive.

## Publish with GitHub Pages

1. Open this repository → **Settings → Pages**.
2. Under **Build and deployment**, set **Source** to **GitHub Actions**.
3. Open **Actions** → **Deploy Interactive Showcase (GitHub Pages)** → **Run workflow** if a deployment has not already started automatically.
4. Wait for **build** and **deploy** to succeed, then visit `https://aram-az.github.io/Q50-Digital-Twin/`.
5. Add that verified URL to the repository's **About → Website** field, and pin the repository on your GitHub profile.

The workflow uses Node 22, `npm ci`, `npm run test:logic`, and `npm run build:showcase`, then publishes `frontend/dist`. The repository name is case-sensitive in the Vite `base` setting (`/Q50-Digital-Twin/`).

## Build locally without running FastAPI

```powershell
cd frontend
npm ci
npm run test:logic
npm run build:showcase
npm run preview:showcase
```

Local `npm run dev` still uses the standard FastAPI proxy and is **not** showcase mode. This separation makes the public UI safely accessible while retaining the full local backend for development. To iterate on the public mode locally, use `npm run dev -- --mode showcase` and open the URL printed in the terminal (the configured base includes `/Q50-Digital-Twin/`).

## Technical choices

- Synthetic samples remain within bounds, at a nominal 10 Hz sample rate.
- Overheating simulation crosses both illustrative thermal thresholds; sensor-dropout simulation has a real timestamp discontinuity.
- A public page cannot start the local FastAPI process or reach a visitor's car; no attempt is made to do so.
- The interactive site uses in-memory history rather than misleadingly advertising server-side persistence.
- No third-party analytics or location collection are added by this showcase.

## Troubleshooting

- **404 at live link:** check that Pages is enabled, workflow deployed, and Vite `base` matches the repository path.
- **Blank screen:** inspect the latest Pages workflow and browser console; verify `frontend/dist/index.html` was uploaded.
- **GitHub Pages deployment is blocked:** ensure Pages Source is set to **GitHub Actions** and Actions are permitted in the repository settings.
- **Controls appear disconnected:** verify that the *showcase* build ran (`npm run build:showcase`), not a normal local production build (`npm run build`).

Official references: [Vite static deployment](https://vite.dev/guide/static-deploy) · [GitHub Pages publishing source](https://docs.github.com/en/pages/getting-started-with-github-pages/configuring-a-publishing-source-for-your-github-pages-site).
