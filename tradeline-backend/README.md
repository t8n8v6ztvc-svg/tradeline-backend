# Tradeline Backend

A small proxy service that sits between the Tradeline dashboard and Finnhub.
It holds the Finnhub API key server-side so it's never exposed in the
browser, and exposes one clean endpoint the frontend can call instead of
talking to Finnhub directly.

## What it does

`GET /api/quote/:symbol` — e.g. `/api/quote/AMD` — returns:

```json
{
  "symbol": "AMD",
  "price": 533.10,
  "high": 540.20,
  "low": 528.40,
  "open": 530.00,
  "previousClose": 512.70,
  "changePct": 4.02,
  "timestamp": 1719421200,
  "cached": false
}
```

Repeated requests for the same symbol within 15 seconds are served from an
in-memory cache instead of hitting Finnhub again, to stay comfortably under
Finnhub's free-tier rate limit.

## Deploying to Railway

1. **Push this folder to a new GitHub repo.**
   - Create a new repo on GitHub (can be private).
   - From inside this folder:
     ```
     git init
     git add .
     git commit -m "Initial backend"
     git branch -M main
     git remote add origin <your-repo-url>
     git push -u origin main
     ```

2. **Create a new Railway project.**
   - Go to railway.app, click **New Project**.
   - Choose **Deploy from GitHub repo**, and select this repo.
   - Railway will detect it's a Node app and deploy it automatically.

3. **Add your Finnhub API key as an environment variable.**
   - In your Railway project, go to the **Variables** tab.
   - Add a variable named `FINNHUB_API_KEY` with your actual key as the value.
   - **Never put the key directly in `server.js` or any committed file** —
     this is the whole point of using an environment variable instead.

4. **Get your live URL.**
   - Once deployed, Railway gives you a public URL (Settings → Generate Domain
     if one isn't shown yet), something like
     `https://tradeline-backend-production.up.railway.app`.
   - Test it by visiting `<that-url>/health` in a browser — it should show
     `{"status":"ok","hasApiKey":true}`.
   - Then test `<that-url>/api/quote/AMD` — it should return real price data.

5. **Give Claude that URL** so the frontend can be pointed at it instead of
   using simulated dashboard data.

## Local testing (optional)

If you want to run this on your own machine before deploying:

```
npm install
FINNHUB_API_KEY=your_key_here npm start
```

Then visit `http://localhost:3001/health` to confirm it's running.
