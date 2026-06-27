import express from "express";
import cors from "cors";
import fetch from "node-fetch";

const app = express();
app.use(cors()); // allow the frontend (any origin, for now) to call this API

const FINNHUB_KEY = process.env.FINNHUB_API_KEY;
const PORT = process.env.PORT || 3001;

if (!FINNHUB_KEY) {
  console.error(
    "Missing FINNHUB_API_KEY environment variable. Set it in Railway's Variables tab — never hardcode it in this file."
  );
}

// Simple in-memory cache so repeated requests for the same symbol within a
// short window don't each burn a Finnhub call. Finnhub's free tier allows
// 60 calls/minute, so this protects against accidentally blowing through
// that if the dashboard polls or multiple tabs are open.
const CACHE_TTL_MS = 15000; // 15 seconds
const quoteCache = new Map(); // symbol -> { data, expiresAt }

// Only allow simple ticker-looking strings through to Finnhub — this is a
// public endpoint once deployed, so we don't want to forward arbitrary
// input to an upstream API call.
const SYMBOL_PATTERN = /^[A-Z.\-]{1,10}$/;

app.get("/api/quote/:symbol", async (req, res) => {
  const symbol = req.params.symbol.toUpperCase();

  if (!SYMBOL_PATTERN.test(symbol)) {
    return res.status(400).json({ error: "Invalid symbol format." });
  }

  if (!FINNHUB_KEY) {
    return res.status(500).json({ error: "Server is missing its API key configuration." });
  }

  const cached = quoteCache.get(symbol);
  if (cached && cached.expiresAt > Date.now()) {
    return res.json({ ...cached.data, cached: true });
  }

  try {
    const url = `https://finnhub.io/api/v1/quote?symbol=${encodeURIComponent(symbol)}&token=${FINNHUB_KEY}`;
    const response = await fetch(url);

    if (!response.ok) {
      return res.status(response.status).json({ error: "Upstream data provider error." });
    }

    const raw = await response.json();

    // Finnhub returns a quote with short keys: c=current, h=high, l=low,
    // o=open, pc=previous close, t=timestamp (unix seconds). Reshape into
    // clearer names so the frontend doesn't need to know Finnhub's format —
    // this is exactly the layer that makes swapping providers later painless.
    const shaped = {
      symbol,
      price: raw.c,
      high: raw.h,
      low: raw.l,
      open: raw.o,
      previousClose: raw.pc,
      changePct: raw.pc ? ((raw.c - raw.pc) / raw.pc) * 100 : null,
      timestamp: raw.t,
    };

    quoteCache.set(symbol, { data: shaped, expiresAt: Date.now() + CACHE_TTL_MS });

    res.json({ ...shaped, cached: false });
  } catch (err) {
    console.error("Quote fetch failed:", err.message);
    res.status(502).json({ error: "Failed to reach upstream data provider." });
  }
});

app.get("/health", (req, res) => {
  res.json({ status: "ok", hasApiKey: Boolean(FINNHUB_KEY) });
});

// Same caching idea as quotes — news doesn't change second-to-second, so
// there's no reason to re-hit Finnhub on every dashboard refresh.
const NEWS_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
const newsCache = new Map(); // symbol -> { data, expiresAt }

app.get("/api/news/:symbol", async (req, res) => {
  const symbol = req.params.symbol.toUpperCase();

  if (!SYMBOL_PATTERN.test(symbol)) {
    return res.status(400).json({ error: "Invalid symbol format." });
  }
  if (!FINNHUB_KEY) {
    return res.status(500).json({ error: "Server is missing its API key configuration." });
  }

  const cached = newsCache.get(symbol);
  if (cached && cached.expiresAt > Date.now()) {
    return res.json({ items: cached.data, cached: true });
  }

  try {
    const to = new Date();
    const from = new Date(to.getTime() - 7 * 24 * 60 * 60 * 1000); // last 7 days
    const fmt = (d) => d.toISOString().slice(0, 10);

    const url = `https://finnhub.io/api/v1/company-news?symbol=${encodeURIComponent(
      symbol
    )}&from=${fmt(from)}&to=${fmt(to)}&token=${FINNHUB_KEY}`;

    const response = await fetch(url);
    if (!response.ok) {
      return res.status(response.status).json({ error: "Upstream news provider error." });
    }

    const raw = await response.json();

    // Finnhub returns an array of articles. Reshape to clear field names,
    // same reasoning as the quote endpoint: the frontend should never need
    // to know Finnhub's specific response shape, which is what makes
    // swapping providers later a contained change.
    const shaped = (Array.isArray(raw) ? raw : [])
      .slice(0, 10) // cap per symbol so the feed doesn't get overwhelmed by one ticker
      .map((item) => ({
        id: item.id,
        symbol,
        headline: item.headline,
        source: item.source,
        url: item.url,
        timestamp: item.datetime ? item.datetime * 1000 : null, // Finnhub uses unix seconds; ms is friendlier for JS Date
      }));

    newsCache.set(symbol, { data: shaped, expiresAt: Date.now() + NEWS_CACHE_TTL_MS });

    res.json({ items: shaped, cached: false });
  } catch (err) {
    console.error("News fetch failed:", err.message);
    res.status(502).json({ error: "Failed to reach upstream news provider." });
  }
});

// Binding explicitly to 0.0.0.0 (all network interfaces) rather than
// relying on Express's default. In some container environments, the
// default bind resolves to localhost only — the app looks like it's
// running fine in the logs, but Railway's external router can't reach
// it, which is exactly the "logs look fine, URL doesn't load" symptom.
app.listen(PORT, "0.0.0.0", () => {
  console.log(`Tradeline backend listening on 0.0.0.0:${PORT}`);
});
