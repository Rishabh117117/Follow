/* eslint-disable no-console -- CLI seeder; console IS the output. */
/**
 * Seed a varied, realistic corpus into the live deploy via MCP save_conversation,
 * so the FACET-FIX-1 PRE-1 gate has data to measure. Each conversation has a clear
 * user QUESTION (→ causal/WHY facet) and substantive assistant CONTENT (→ content/
 * WHAT facet) across diverse topics (→ cross-record cosine variance).
 *
 *   E2E_URL=https://<api> E2E_MCP_KEY=wsp_... npx tsx scripts/preflight/seed-corpus.ts
 */
const BASE = (process.env['E2E_URL'] || '').replace(/\/+$/, '')
const KEY = process.env['E2E_MCP_KEY'] || ''
const TAG = process.env['SEED_TAG'] || 'seed'

type Conv = { title: string; q: string; a: string; q2?: string; a2?: string }

const CONVS: Conv[] = [
  {
    title: 'Sourdough hydration',
    q: 'Why does higher hydration make sourdough crumb more open?',
    a: 'Higher hydration dough has more free water, which produces more steam during baking and a slacker gluten network that traps larger gas bubbles, giving a more open, irregular crumb. It also makes the dough harder to shape.',
    q2: 'So what hydration should a beginner start at?',
    a2: 'Start around 65-70% hydration — open enough to be interesting but still shapeable by hand without sticking everywhere.',
  },
  {
    title: 'TCP vs UDP',
    q: 'Why would a video call use UDP instead of TCP?',
    a: 'Real-time video tolerates a few lost frames far better than the latency of TCP retransmission and head-of-line blocking. UDP lets late or lost packets be dropped so the stream stays current, trading reliability for low latency.',
  },
  {
    title: 'Espresso extraction',
    q: 'Why is my espresso sour rather than bitter?',
    a: 'Sourness means under-extraction: water passed through too fast to dissolve enough of the sweeter, later-extracting compounds. Grind finer, tamp evenly, or raise the dose so the shot runs slower and extracts more fully.',
  },
  {
    title: 'Index funds',
    q: 'Why do index funds usually beat actively managed funds over time?',
    a: 'Most active managers fail to overcome their fees and trading costs, and markets are efficient enough that consistent stock-picking edges are rare. Broad index funds capture market returns at very low cost, so the fee gap compounds in their favor.',
  },
  {
    title: 'Photosynthesis C4',
    q: 'Why did C4 photosynthesis evolve in hot climates?',
    a: 'C4 plants concentrate CO2 around RuBisCO, suppressing wasteful photorespiration that worsens at high temperature and low CO2. In hot, dry, bright environments this gives C4 species a real efficiency and water-use advantage over C3 plants.',
  },
  {
    title: 'Rust borrow checker',
    q: 'Why does Rust forbid two mutable references to the same value?',
    a: 'Allowing two mutable references would permit data races and aliasing bugs the compiler cannot reason about. The borrow checker enforces exactly one mutable XOR many shared references so memory safety is guaranteed at compile time.',
  },
  {
    title: 'Marathon tapering',
    q: 'Why do runners taper before a marathon?',
    a: 'Tapering reduces training volume so glycogen stores refill, micro-damage repairs, and fatigue dissipates while fitness is retained. You arrive at the start line fresh rather than worn down from peak training.',
  },
  {
    title: 'Why sky is blue',
    q: 'Why is the daytime sky blue but sunsets red?',
    a: 'Rayleigh scattering scatters short blue wavelengths much more than red, so the overhead sky looks blue. At sunset light travels through more atmosphere, blue is scattered away before reaching you, leaving the reds and oranges.',
  },
  {
    title: 'Database indexing',
    q: 'Why can adding an index slow down writes?',
    a: 'Each index is a separate structure the database must keep in sync, so every insert, update, or delete also has to maintain the index. More indexes mean faster reads but more write amplification and storage.',
  },
  {
    title: 'Yeast vs baking soda',
    q: 'Why use yeast in bread but baking soda in cookies?',
    a: 'Yeast ferments slowly, producing CO2 plus flavor compounds over hours, ideal for bread structure. Baking soda reacts instantly with acid to release gas, giving quick lift for batters and cookies that bake fast.',
  },
  {
    title: 'Compound interest',
    q: 'Why is starting to invest early so powerful?',
    a: 'Compound interest means earnings themselves earn returns, so growth is exponential. Money invested early has many more compounding cycles, so an early small contribution can outgrow a larger one made decades later.',
  },
  {
    title: 'Vaccines mRNA',
    q: 'Why are mRNA vaccines faster to develop than traditional ones?',
    a: 'Traditional vaccines need cultured virus or protein, which is slow to grow and purify. mRNA vaccines just need the genetic sequence; once known, you synthesize the mRNA chemically, so design-to-candidate can take days rather than months.',
  },
  {
    title: 'Cache invalidation',
    q: 'Why is cache invalidation considered hard?',
    a: 'A cache is a copy that can silently go stale when the source changes. Knowing exactly when and what to invalidate across distributed copies, without serving stale data or thrashing the cache, has many subtle edge cases.',
  },
  {
    title: 'Sleep cycles',
    q: 'Why do I feel groggy waking from deep sleep?',
    a: 'Waking during slow-wave deep sleep causes sleep inertia: the brain is in its most disconnected, restorative state and needs time to re-engage. Waking in lighter sleep stages feels much smoother.',
  },
  {
    title: 'Electric car regen',
    q: 'Why do electric cars get better range in city driving?',
    a: 'Regenerative braking recaptures kinetic energy back into the battery during the frequent stops of city driving, while gas cars waste it as heat. Highways have less braking, so EVs lose that recapture advantage.',
  },
  {
    title: 'Functional immutability',
    q: 'Why does functional programming favor immutable data?',
    a: 'Immutable data cannot be changed under you, so functions become predictable, easy to test, and safe to share across threads without locks. The tradeoff is more copying, which modern structural sharing largely mitigates.',
  },
  {
    title: 'Wine tannins',
    q: 'Why does red wine have more tannin than white?',
    a: 'Reds ferment in contact with grape skins, seeds, and sometimes stems, which leach tannins. Whites are usually pressed off the skins before fermentation, so they pick up far less tannin.',
  },
  {
    title: 'Load balancing',
    q: 'Why prefer least-connections over round-robin load balancing?',
    a: 'Round-robin assumes every request costs the same; least-connections routes to the server with the fewest active requests, which handles uneven request durations better and avoids piling slow work on one node.',
  },
  {
    title: 'Muscle soreness',
    q: 'Why am I sore two days after a workout, not the next day?',
    a: 'Delayed onset muscle soreness peaks 24-72 hours later because it comes from microscopic muscle damage and the subsequent inflammatory repair response, not from lactic acid, which clears within an hour.',
  },
  {
    title: 'HTTPS handshake',
    q: 'Why does HTTPS use both asymmetric and symmetric encryption?',
    a: 'Asymmetric crypto safely exchanges a shared secret without a pre-shared key but is slow. Once the secret is established, the connection switches to fast symmetric encryption for the bulk data, getting both security and speed.',
  },
  {
    title: 'Caramelization',
    q: 'Why do onions get sweet when caramelized?',
    a: 'Long slow heat breaks complex carbohydrates into simpler sugars and drives off water while Maillard and caramelization reactions create deep flavor. The result tastes far sweeter and richer than raw onion.',
  },
  {
    title: 'Diversification',
    q: 'Why does diversification reduce portfolio risk?',
    a: 'Assets that do not move in lockstep partly cancel each other out, so the portfolio swings less than its components. You reduce idiosyncratic risk without necessarily sacrificing expected return.',
  },
  {
    title: 'Garbage collection',
    q: 'Why can garbage collection cause latency spikes?',
    a: 'A collector may pause application threads to safely scan and reclaim memory. If a large heap is collected in a stop-the-world phase, that pause shows up as a latency spike; concurrent collectors trade throughput to shrink it.',
  },
  {
    title: 'Altitude breathing',
    q: 'Why is it harder to breathe at high altitude?',
    a: 'Air pressure drops with altitude, so each breath delivers fewer oxygen molecules even though the percentage of oxygen is unchanged. Lower partial pressure means less oxygen crosses into your blood.',
  },
  {
    title: 'Idempotency APIs',
    q: 'Why should a payment API be idempotent?',
    a: 'Networks retry, so the same request may arrive twice. An idempotency key lets the server recognize the duplicate and return the original result instead of charging the customer twice.',
  },
  {
    title: 'Bread salt role',
    q: 'Why does bread dough need salt beyond taste?',
    a: 'Salt tightens the gluten network for better structure and controls yeast activity so fermentation is steady rather than runaway. Saltless dough rises too fast and bakes up slack and bland.',
  },
  {
    title: 'Dollar cost averaging',
    q: 'Why might dollar-cost averaging help a nervous investor?',
    a: 'Buying a fixed amount on a schedule removes the temptation to time the market and smooths your average price across ups and downs. It trades some expected return for far less behavioral risk.',
  },
  {
    title: 'Eventual consistency',
    q: 'Why do distributed databases accept eventual consistency?',
    a: 'The CAP tradeoff means that during a network partition you must choose availability or strong consistency. Many systems pick availability and let replicas converge afterward, accepting brief staleness for uptime.',
  },
  {
    title: 'Stretching debate',
    q: 'Why is static stretching before sprinting discouraged?',
    a: 'Holding long static stretches just before explosive effort can transiently reduce power and force output. A dynamic warm-up that mimics the movement primes the muscles better for sprinting.',
  },
  {
    title: 'Knife sharpening',
    q: 'Why does a sharper knife feel safer to use?',
    a: 'A sharp edge bites where you place it with light pressure, so it is predictable. A dull knife needs force and can slip off the food, which is when accidents happen.',
  },
]

/**
 * CONTRADICT-1: clustered contradictory pairs. Each pair is two notes about the
 * SAME decision with OPPOSITE conclusions, phrased near-identically so their
 * composite embedding clears the link threshold (≥0.55 same-user) and the ANALYST
 * is asked to classify the pair → a `contradicts` edge. (The 30-distinct-topic
 * CONVS above produce 0 candidates; this is the instrument that was missing.)
 * Indexed as separate conversations so they cross-link (a just-inserted batch is
 * not compared against itself). Exported so the local verifier reuses them.
 */
export const CONTRADICTION_PAIRS: { topic: string; a: Conv; b: Conv }[] = [
  {
    topic: 'session cache',
    a: {
      title: 'Session cache decision',
      q: 'What did we decide for the session cache?',
      a: 'We decided to use Postgres for the session cache because it keeps our stack simple and consistent.',
    },
    b: {
      title: 'Session cache decision',
      q: 'What did we decide for the session cache?',
      a: 'We decided to use Redis for the session cache because it is much faster for ephemeral data.',
    },
  },
  {
    topic: 'launch date',
    a: {
      title: 'Launch date',
      q: 'When is the product launch?',
      a: 'The launch date is locked to March 15 and we are not moving it.',
    },
    b: {
      title: 'Launch date',
      q: 'When is the product launch?',
      a: 'The launch date moved to April 20 after the scope review pushed it back.',
    },
  },
  {
    topic: 'auth approach',
    a: {
      title: 'Auth approach',
      q: 'How are we handling authentication?',
      a: 'We are using stateless JWT tokens for authentication across all services.',
    },
    b: {
      title: 'Auth approach',
      q: 'How are we handling authentication?',
      a: 'We are using stateful server-side sessions for authentication, not JWT tokens.',
    },
  },
]

async function callTool(tool: string, body: unknown) {
  const url = new URL(`${BASE}/api/mcp-rest/${tool}`)
  if (KEY) url.searchParams.set('key', KEY)
  const res = await fetch(url.toString(), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const json = (await res.json().catch(() => ({}))) as {
    data?: { content?: Array<{ text?: string }>; isError?: boolean }
    error?: unknown
  }
  return { status: res.status, json }
}

async function main() {
  if (!BASE || !KEY) {
    console.error('Need E2E_URL and E2E_MCP_KEY')
    process.exit(2)
  }
  // SEED_MODE=contradictions → seed the clustered contradictory pairs instead.
  const mode = process.env['SEED_MODE'] ?? 'default'
  const convs = mode === 'contradictions' ? CONTRADICTION_PAIRS.flatMap((p) => [p.a, p.b]) : CONVS
  console.log(`Seeding ${convs.length} conversations into ${BASE} (tag=${TAG}, mode=${mode})\n`)
  let ok = 0
  let fail = 0
  for (let i = 0; i < convs.length; i++) {
    const c = convs[i]!
    const messages = [
      { role: 'user', content: `${c.q}` },
      { role: 'assistant', content: c.a },
    ]
    if (c.q2 && c.a2) {
      messages.push({ role: 'user', content: c.q2 })
      messages.push({ role: 'assistant', content: c.a2 })
    }
    const r = await callTool('save-conversation', {
      source_type: 'claude',
      title: `[${TAG}] ${c.title}`,
      messages,
    })
    const isErr = r.status !== 200 || r.json.data?.isError
    if (isErr) {
      fail++
      console.log(
        `  ✗ ${c.title}: HTTP ${r.status} ${JSON.stringify(r.json.error ?? r.json.data)}`.slice(
          0,
          160
        )
      )
    } else {
      ok++
      if ((i + 1) % 10 === 0) console.log(`  …${i + 1}/${convs.length}`)
    }
    // small gap so the per-save background indexing isn't hammered
    await new Promise((res) => setTimeout(res, 400))
  }
  console.log(`\nDone: ${ok} saved, ${fail} failed.`)
  process.exit(fail > 0 && ok === 0 ? 1 : 0)
}
// Only auto-run when invoked directly (so the exported corpus can be imported
// by the local verifier without triggering a seed run).
if (process.argv[1] && /seed-corpus\.ts$/.test(process.argv[1].replace(/\\/g, '/'))) {
  main().catch((e) => {
    console.error('[seed] crashed:', e)
    process.exit(1)
  })
}
