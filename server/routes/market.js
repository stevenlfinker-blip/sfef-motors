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

function buildQueries(year, make, model, category) {
  const exact = `"${year} ${make} ${model}"`;
  const car   = `${year} ${make} ${model}`;
  const now   = new Date().getFullYear();
  const range = `${now - 2} ${now - 1} ${now}`;
  const isCollectable = category === 'Collectable';

  if (isCollectable) {
    return [
      `site:bringatrailer.com ${exact}`,
      `site:bringatrailer.com ${car} sold`,
      `site:rmsothebys.com ${exact}`,
      `site:barrett-jackson.com ${exact} sold`,
      `site:mecum.com ${exact} sold`,
      `site:hagerty.com ${exact} value`,
      `site:classic.com ${exact}`,
      `site:dupont-registry.com ${exact}`,
      `${exact} sold auction hammer price ${range}`,
      `${exact} collector car market value ${range}`,
    ];
  } else {
    // Daily drivers and leases — use retail/trade-in sources
    return [
      `${exact} market value ${range}`,
      `${exact} for sale price ${now}`,
      `site:kbb.com ${car} value`,
      `site:edmunds.com ${car} price`,
      `site:autotrader.com ${car} for sale`,
      `site:cargurus.com ${car} market value`,
      `${exact} depreciation resale value`,
      `${exact} trade-in value ${range}`,
      `${car} used car price ${range}`,
      `${exact} dealer price listing ${now}`,
    ];
  }
}

function isRelevantResult(r, make, model) {
  const text = `${r.title || ''} ${r.url || ''} ${r.content || ''}`.toLowerCase();
  return text.includes(make.toLowerCase()) && text.includes(model.toLowerCase().split(' ')[0]);
}

function extractPrices(text) {
  const matches = (text || '').match(/\$[\d,]+(?:\.\d+)?/g) || [];
  return [...new Set(matches)]
    .map(p => parseInt(p.replace(/[$,]/g, '')))
    .filter(p => p >= 5000)
    .sort((a, b) => b - a)
    .map(p => '$' + p.toLocaleString());
}

function formatResults(results) {
  return results.map((r, i) => {
    const combined = `${r.title || ''} ${r.content || ''}`;
    const prices = extractPrices(combined);
    const priceStr = prices.length ? `  Prices found: ${prices.slice(0, 6).join(', ')}` : '';
    return `[${i + 1}] ${r.title}\n${r.url}${priceStr}\n${r.content?.slice(0, 500) || ''}`;
  }).join('\n\n');
}

function buildPrompt(specs, category, searchContext) {
  const today = new Date().toDateString();
  const isCollectable = category === 'Collectable';

  const methodology = isCollectable ? `
VALUATION METHODOLOGY — COLLECTIBLE / LIMITED PRODUCTION:
- These cars do NOT follow standard depreciation curves
- "avg" = where this car trades at auction or private sale TODAY, anchored to the MOST RECENT comps
- If prices are rising year-over-year, avg must reflect the current trajectory — not an average of old and new
- Do NOT round down to be conservative — use recent hammer prices as your floor, not your ceiling
- "low" = realistic no-reserve floor from the lowest recent comp; "high" = top recent result for best spec
- Mileage adjustment: ultra-low miles (<500) command large premiums; higher miles (>10k) modest discount
- Color adjustment: rare/PTS colors command premiums; common colors are neutral` : `
VALUATION METHODOLOGY — DAILY DRIVER / MODERN VEHICLE:
- Apply standard market depreciation based on age, mileage, and condition
- "avg" = current private-party market value based on comparable listings and recent sales
- Use KBB, Edmunds, CarGurus, and AutoTrader data as primary references
- Mileage adjustment: compare to average annual mileage (~12-15k/year); adjust accordingly
- Condition and spec (trim level, options) affect value — use notes/VIN if available
- "low" = trade-in / wholesale value; "high" = retail asking price for clean examples`;

  return `You are an expert automotive appraiser conducting an in-depth market analysis. Today's date is ${today}.

VEHICLE SPECS:
${specs}

LIVE MARKET SEARCH RESULTS:
${searchContext}
${methodology}

ANALYSIS STEPS — work through each before outputting JSON:
1. Extract every price ≥ $5,000 from the search results with its source and approximate date
2. Discard any comp older than 3 years or about a different make/model/year
3. Sort remaining comps newest first — the most recent 3-5 sales are your primary anchors
4. Identify the closest comps to THIS car's mileage, color, and spec
5. Apply appropriate adjustments for mileage delta, color, and condition
6. Set avg = where this specific car sells TODAY; set low and high accordingly

Respond with ONLY a valid JSON object — no preamble, no explanation outside the JSON:
{
  "low": number (USD, no commas or symbols),
  "avg": number (USD, current market value for this specific car),
  "high": number (USD, top of market for best spec/condition),
  "trend": "Appreciating" | "Stable" | "Depreciating",
  "market_note": string (2-3 sentences: cite the 3 most relevant recent comps with exact price, date, mileage, and source; then explain how this car's specific color, mileage, and spec adjust the value up or down from those comps)
}`;
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
    `Category: ${car.category || 'Daily'}`,
    car.color     ? `Color: ${car.color}`         : null,
    car.mileage   ? `Mileage: ${car.mileage}`     : null,
    car.vin       ? `VIN: ${car.vin}`             : null,
    car.status    ? `Status: ${car.status}`        : null,
    car.ownership ? `Ownership: ${car.ownership}`  : null,
    car.notes     ? `Notes: ${car.notes}`          : null,
  ].filter(Boolean).join('\n');

  try {
    const queries = buildQueries(car.year, car.make, car.model, car.category);
    // First 4 queries get advanced depth for richer content
    const resultSets = await Promise.all(queries.map((q, i) => tavilySearch(q, i < 4)));

    const seen = new Set();
    const allResults = resultSets.flat().filter(r => {
      if (!r.url || seen.has(r.url)) return false;
      if (!isRelevantResult(r, car.make, car.model)) return false;
      seen.add(r.url);
      return true;
    });

    const searchContext = formatResults(allResults);
    const sources = allResults.map(r => ({ title: r.title, url: r.url })).slice(0, 12);
    const prompt = buildPrompt(specs, car.category, searchContext);

    const message = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 1500,
      messages: [{ role: 'user', content: prompt }],
    });

    const text = message.content.find(b => b.type === 'text')?.text || '';
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) throw new Error('Could not parse valuation response');
    const v = JSON.parse(match[0]);

    const now = new Date().toISOString();
    const result = db.prepare(
      'INSERT INTO car_valuations (car_id, low, avg, high, trend, market_note, sources, fetched_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
    ).run(car.id, v.low, v.avg, v.high, v.trend || '', v.market_note || '', JSON.stringify(sources), now);

    db.prepare('UPDATE cars SET value = ? WHERE id = ?').run(v.avg, car.id);

    res.json(db.prepare('SELECT * FROM car_valuations WHERE id = ?').get(result.lastInsertRowid));
  } catch (err) {
    console.error('Valuation error:', err.message);
    res.status(500).json({ error: 'Failed to fetch valuation. Try again.' });
  }
});

module.exports = router;
