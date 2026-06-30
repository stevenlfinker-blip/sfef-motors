const express = require('express');
const router = express.Router();
const db = require('../db');
const Anthropic = require('@anthropic-ai/sdk');

const anthropic = process.env.ANTHROPIC_API_KEY ? new Anthropic() : null;
const TAVILY_KEY = process.env.TAVILY_API_KEY;

async function tavilySearch(query, advanced = false) {
  try {
    const res = await fetch('https://api.tavily.com/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        api_key: TAVILY_KEY,
        query,
        search_depth: advanced ? 'advanced' : 'basic',
        max_results: advanced ? 10 : 5,
        include_raw_content: false,
        include_answer: false,
      }),
    });
    if (!res.ok) return [];
    const data = await res.json();
    return data.results || [];
  } catch (_) { return []; }
}

function buildQueries(year, make, model) {
  const exact = `"${year} ${make} ${model}"`;
  const car   = `${year} ${make} ${model}`;
  const now   = new Date().getFullYear();
  const range = `${now - 2} ${now - 1} ${now}`;
  return [
    `site:bringatrailer.com ${exact}`,
    `site:bringatrailer.com ${car} sold`,
    `site:rmsothebys.com ${exact}`,
    `site:barrett-jackson.com ${exact} sold`,
    `site:mecum.com ${exact} sold`,
    `site:hagerty.com ${exact} value`,
    `site:classic.com ${exact}`,
    `site:dupont-registry.com ${exact}`,
    `${exact} sold price auction result ${range}`,
    `${exact} market value sale ${range}`,
  ];
}

function isRelevantResult(r, make, model) {
  const text = `${r.title || ''} ${r.url || ''} ${r.content || ''}`.toLowerCase();
  return text.includes(make.toLowerCase()) && text.includes(model.toLowerCase().split(' ')[0]);
}

function extractPrices(text) {
  const matches = (text || '').match(/\$[\d,]+(?:\.\d+)?/g) || [];
  return [...new Set(matches)]
    .map(p => parseInt(p.replace(/[$,]/g, '')))
    .filter(p => p >= 10000)
    .map(p => '$' + p.toLocaleString());
}

function formatResults(results) {
  const lines = results.map((r, i) => {
    const combined = `${r.title || ''} ${r.content || ''}`;
    const prices = extractPrices(combined);
    const priceStr = prices.length ? `  💰 Prices found: ${prices.slice(0, 5).join(', ')}` : '';
    return `[${i + 1}] ${r.title}\n${r.url}${priceStr}\n${r.content?.slice(0, 500) || ''}`;
  });
  return lines.join('\n\n');
}

// GET all latest valuations (one per car)
router.get('/', (req, res) => {
  const rows = db.prepare(`
    SELECT cv.*, c.year, c.make, c.model, c.color, c.mileage, c.value as stored_value, c.category, c.status
    FROM car_valuations cv
    JOIN cars c ON c.id = cv.car_id
    WHERE cv.id = (
      SELECT id FROM car_valuations WHERE car_id = cv.car_id ORDER BY fetched_at DESC LIMIT 1
    )
    ORDER BY c.make, c.model
  `).all();
  res.json(rows);
});

// POST /api/market/:carId — run a fresh valuation for one car
router.post('/:carId', async (req, res) => {
  if (!anthropic) return res.status(503).json({ error: 'ANTHROPIC_API_KEY not configured' });
  if (!TAVILY_KEY) return res.status(503).json({ error: 'TAVILY_API_KEY not configured' });

  const car = db.prepare('SELECT * FROM cars WHERE id = ?').get(req.params.carId);
  if (!car) return res.status(404).json({ error: 'Car not found' });

  const specs = [
    `Year: ${car.year}`,
    `Make: ${car.make}`,
    `Model: ${car.model}`,
    car.color    ? `Color: ${car.color}`        : null,
    car.mileage  ? `Mileage: ${car.mileage}`    : null,
    car.vin      ? `VIN: ${car.vin}`            : null,
    car.status   ? `Status: ${car.status}`      : null,
    car.ownership? `Ownership: ${car.ownership}`: null,
    car.notes    ? `Notes: ${car.notes}`        : null,
  ].filter(Boolean).join('\n');

  const carDesc = `${car.year} ${car.make} ${car.model}${car.color ? ` (${car.color})` : ''}${car.mileage ? `, ${car.mileage} miles` : ''}`;

  try {
    // Run all searches in parallel — BaT and RM get advanced depth for richer price data
    const queries = buildQueries(car.year, car.make, car.model);
    const resultSets = await Promise.all(queries.map((q, i) => tavilySearch(q, i < 4)));

    // Deduplicate by URL and filter to only results about this exact vehicle
    const seen = new Set();
    const allResults = resultSets.flat().filter(r => {
      if (!r.url || seen.has(r.url)) return false;
      if (!isRelevantResult(r, car.make, car.model)) return false;
      seen.add(r.url);
      return true;
    });

    const searchContext = formatResults(allResults);
    const sources = allResults.map(r => ({ title: r.title, url: r.url })).slice(0, 12);

    const message = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 1024,
      messages: [{
        role: 'user',
        content: `You are an expert collector car appraiser. Today's date is ${new Date().toDateString()}. Using the vehicle specs and live search results below, determine the precise current US market value for this specific car.

VEHICLE SPECS:
${specs}

LIVE SEARCH RESULTS:
${searchContext}

Step 1 — Extract every sale price ≥ $10,000 from the results above. List each one with its date and source.
Step 2 — Discard any comp older than 3 years or about a different make/model/year.
Step 3 — Sort remaining comps by date, newest first. The most recent 3-4 sales are your primary anchors.
Step 4 — Adjust for this car's specific mileage vs the comps (pro-rate a premium or discount).
Step 5 — Output the JSON below.

Valuation rules:
- "avg" = where this exact car trades TODAY based on the most recent comps — NOT a midpoint of all-time data
- If the most recent comps are above $500K, avg must be above $500K — do not round down
- Limited-production collectibles do NOT depreciate — if prices are rising, avg must reflect the current ceiling
- "low" = realistic no-reserve floor based on the lowest recent comp; "high" = best recent result for top spec
- Adjust for color premium/discount and mileage relative to comps

Respond with ONLY a JSON object, no other text:
{
  "low": number,
  "avg": number,
  "high": number,
  "trend": "Appreciating" | "Stable" | "Depreciating",
  "market_note": string (cite the 2-3 most relevant recent sales with exact prices, dates, mileage, and source — then explain how this car's specs adjust from those comps)
}

Respond with ONLY a JSON object, no other text:
{
  "low": number (realistic minimum — motivated seller, no reserve),
  "avg": number (what this exact car sells for today based on recent 2025-2026 comps),
  "high": number (top of market — exceptional spec, ultra-low miles, or strong provenance),
  "trend": one of "Appreciating" | "Stable" | "Depreciating",
  "market_note": string (one sentence citing the most relevant recent sales with prices and dates, and noting how this car's specific specs affect value)
}`,
      }],
    });

    const text = message.content.find(b => b.type === 'text')?.text || '';
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) throw new Error('Could not parse valuation response');
    const v = JSON.parse(match[0]);

    const now = new Date().toISOString();
    const result = db.prepare(
      'INSERT INTO car_valuations (car_id, low, avg, high, trend, market_note, sources, fetched_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
    ).run(car.id, v.low, v.avg, v.high, v.trend || '', v.market_note || '', JSON.stringify(sources), now);

    // Keep stored value in sync with market avg
    db.prepare('UPDATE cars SET value = ? WHERE id = ?').run(v.avg, car.id);

    res.json(db.prepare('SELECT * FROM car_valuations WHERE id = ?').get(result.lastInsertRowid));
  } catch (err) {
    console.error('Valuation error:', err.message);
    res.status(500).json({ error: 'Failed to fetch valuation. Try again.' });
  }
});

module.exports = router;
