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
  const car = `${year} ${make} ${model}`;
  return [
    `site:bringatrailer.com ${car}`,
    `site:carsandbids.com ${car}`,
    `site:rmsothebys.com ${car}`,
    `site:barrett-jackson.com ${car} sold`,
    `site:mecum.com ${car} sold`,
    `site:hagerty.com ${car} value`,
    `site:classic.com ${car}`,
    `site:dupont-registry.com ${car}`,
    `${car} sold price auction result 2025 2026`,
    `${car} market value private sale 2025 2026`,
  ];
}

function formatResults(results) {
  return results.map((r, i) =>
    `[${i + 1}] ${r.title}\n${r.url}\n${r.content?.slice(0, 250) || ''}`
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

    // Deduplicate by URL, keep order
    const seen = new Set();
    const allResults = resultSets.flat().filter(r => {
      if (!r.url || seen.has(r.url)) return false;
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
- Use ALL specs above to refine the valuation — color, mileage, VIN, condition, and notes all affect value significantly
- Prioritize 2025 and 2026 sales above all others — recent comps are far more relevant than older ones
- "avg" should reflect what this exact car would realistically sell for TODAY, not a conservative floor
- Do not anchor to MSRP or older sales — use the most recent hammer prices and asking prices as your primary reference
- For collectibles and appreciating cars, lean toward the upper end of recent comps
- Adjust for the specific color (some colors command premiums), mileage relative to comps, and any special notes
- "low" = realistic minimum for a motivated seller; "high" = top of market for exceptional spec or provenance

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
