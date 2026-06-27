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

app.listen(PORT, () => {
  console.log(`Tradeline backend listening on port ${PORT}`);
});
