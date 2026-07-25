/**
 * Built-in Memory Profiles (Sprint MEM-1)
 *
 * Five profiles shipped with every index. Each carries a prompt template
 * that the generator feeds to the LLM alongside the index digest. The
 * generator expects the model to emit `{ sections: [{ key, title, content }] }`
 * matching the `sectionKeys` order below.
 */

export interface BuiltInProfile {
  slug: string
  name: string
  description: string
  sortOrder: number
  sectionKeys: Array<{ key: string; title: string }>
  promptTemplate: string
}

const BASE_INSTRUCTIONS = `
You are summarizing one user's personal AI-context index into memory sections.
You will receive a JSON digest with \`counts\`, \`recentFacts\` (short event
labels), \`recentThreads\` (conversation titles), and \`recentFiles\`.

Return ONLY valid JSON with this exact shape:
{ "sections": [ { "key": "<slug>", "title": "<title>", "content": "<markdown>" } ] }

Do not include keys outside the list provided by the profile. Keep each
section's \`content\` under 250 words. Use plain markdown (no headings,
bullets with "-"). If the digest is too thin to say anything meaningful
for a section, write a single line like "Not enough data yet — index more
content to populate this section."
`.trim()

export const BUILT_IN_PROFILES: BuiltInProfile[] = [
  {
    slug: 'activity',
    name: 'Activity',
    description: 'What the user has been working on recently.',
    sortOrder: 0,
    sectionKeys: [
      { key: 'recent-focus', title: 'Recent focus' },
      { key: 'active-threads', title: 'Active threads' },
      { key: 'momentum', title: 'Momentum' },
    ],
    promptTemplate: `${BASE_INSTRUCTIONS}

Profile: Activity. Required section keys in order:
- recent-focus — 2–4 sentences describing the themes of the most recent facts + threads.
- active-threads — bulleted list naming the top 3–5 threads the user has been returning to, with one line each about what they're about.
- momentum — a short read on whether activity is rising, steady, or tapering off, grounded in timestamps.`,
  },
  {
    slug: 'general-summary',
    name: 'General Summary',
    description: 'One-page overview of what this index is about.',
    sortOrder: 1,
    sectionKeys: [
      { key: 'overview', title: 'Overview' },
      { key: 'themes', title: 'Themes' },
      { key: 'notable', title: 'Notable items' },
    ],
    promptTemplate: `${BASE_INSTRUCTIONS}

Profile: General Summary. Required section keys in order:
- overview — 2–4 sentences capturing what this index is, at its current size and content.
- themes — bulleted list of 3–6 recurring subjects, each with one line of explanation.
- notable — 3–5 bullets calling out specific standout facts, files, or threads worth remembering.`,
  },
  {
    slug: 'topics',
    name: 'Topics',
    description: 'Recurring subjects clustered from facts and threads.',
    sortOrder: 2,
    sectionKeys: [
      { key: 'top-topics', title: 'Top topics' },
      { key: 'emerging', title: 'Emerging' },
      { key: 'quiet', title: 'Quiet topics' },
    ],
    promptTemplate: `${BASE_INSTRUCTIONS}

Profile: Topics. Cluster the digest by subject and label each cluster. Required section keys in order:
- top-topics — bulleted list, 3–6 entries. Each: "- **Topic**: one-sentence summary (N facts)".
- emerging — topics that have appeared only in the last few entries. 0–4 bullets; if none, say "No emerging topics yet."
- quiet-topics — topics once active but cold now (older timestamps). 0–4 bullets; if none, say "No dormant topics to report."`,
  },
  {
    slug: 'key-facts',
    name: 'Key Facts',
    description: 'Standout facts worth remembering.',
    sortOrder: 3,
    sectionKeys: [
      { key: 'decisions', title: 'Decisions' },
      { key: 'commitments', title: 'Commitments & plans' },
      { key: 'references', title: 'Key references' },
    ],
    promptTemplate: `${BASE_INSTRUCTIONS}

Profile: Key Facts. Scan the digest for high-signal items. Required section keys in order:
- decisions — bulleted list of concrete decisions or conclusions visible in the facts. 0–6 bullets.
- commitments — plans, deadlines, or next steps mentioned. 0–6 bullets.
- references — named artifacts (files, URLs, documents, tools) the user has been working with. 0–6 bullets.`,
  },
  {
    slug: 'people-entities',
    name: 'People & Entities',
    description: 'Names, tools, and artifacts that appear across the index.',
    sortOrder: 4,
    sectionKeys: [
      { key: 'people', title: 'People' },
      { key: 'tools-products', title: 'Tools & products' },
      { key: 'places-orgs', title: 'Places & organizations' },
    ],
    promptTemplate: `${BASE_INSTRUCTIONS}

Profile: People & Entities. Required section keys in order:
- people — named humans mentioned in the digest, with one line of context each. 0–8 bullets.
- tools-products — software, products, or models referenced. 0–8 bullets.
- places-orgs — companies, organizations, or locations. 0–8 bullets.

If a category has no entries, write: "None found in recent activity."`,
  },
]

export function findBuiltInProfile(slug: string): BuiltInProfile | undefined {
  return BUILT_IN_PROFILES.find((p) => p.slug === slug)
}
