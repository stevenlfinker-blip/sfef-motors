const express = require('express');
const router = express.Router();
const db = require('../db');
const Anthropic = require('@anthropic-ai/sdk');

const anthropic = process.env.ANTHROPIC_API_KEY ? new Anthropic() : null;
const TAVILY_KEY = process.env.TAVILY_API_KEY;

async function tavilySearch(query) {
  try {
    const res = await fetch('https://api.tavily.com/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        api_key: TAVILY_KEY,
        query,
        search_depth: 'basic',
        max_results: 5,
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

function formatResults(results) {
  return results.map((r, i) =>
    `[${i + 1}] ${r.title}\n${r.url}\n${r.content?.slice(0, 300) || ''}`
  ).join('\n\n');
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
    // Run all searches in parallel
    const queries = buildQueries(car.year, car.make, car.model);
    const resultSets = await Promise.all(queries.map(q => tavilySearch(q)));

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
        content: `You are an expert collector car appraiser. Using the vehicle specs and live search results below, determine the precise current US market value for this specific car.

VEHICLE SPECS:
${specs}

LIVE SEARCH RESULTS:
${searchContext}

Instructions:
- ONLY use search results specifically about this exact vehicle — discard any result about a different make, model, or year
- Use comps with similar mileage and spec — a 200-mile example is not a valid comp for a 10,000-mile car and vice versa
- Use ALL specs to refine the valuation — color, mileage, VIN, condition, and notes all affect value
- Search results cover the last 3 years (${new Date().getFullYear() - 2}–${new Date().getFullYear()}) — weight the most recent sales most heavily
- "avg" must reflect what this car sells for RIGHT NOW based on the most recent hammer prices, not a midpoint of all-time data
- Do NOT anchor to MSRP or depreciation curves — limited-production collectibles do not follow normal depreciation
- If the car is clearly appreciating (rising auction results over time), the avg should reflect the current upward trajectory, not an average of old and new prices
- Never undervalue a known appreciating collectible — use the current market ceiling as your reference, not the floor
- "low" = what a motivated seller gets with no reserve; "high" = top of market for best spec or provenance

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
