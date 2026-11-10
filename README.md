
## Private style guide (not in Git)

The writing guide (voice, rules, examples, prompt template) is confidential and
lives only in the server-only environment variable `VENDOR_REPLY_GUIDE` (scope: **Functions**).
The prompt is assembled on the server after the password check, and only the
generated text is returned. If the variable is missing or invalid, the tool
answers 503 "Style guide is not configured" before any paid model call.

Setup (owner approval required; it changes production configuration):
1. Keep the real guide JSON **outside** this repository. Shape: `docs/style-guide.example.json` (fictional).
2. `node scripts/guide-env-value.mjs /path/to/guide.json > /path/outside/repo/guide.value`
   (checks the shape and the 4 KB function-environment budget).
3. Netlify → Site configuration → Environment variables → add `VENDOR_REPLY_GUIDE`, paste the value,
   Scopes: **Functions only**, all deploy contexts. Redeploy.

Other settings: TOOL_PASSWORD, ANTHROPIC_API_KEY.

Check the 4 KB function-environment budget (prints names and sizes only):
`netlify env:list --json --context production --scope functions | node scripts/check-env-budget.mjs --plan VENDOR_REPLY_GUIDE=/path/outside/repo/guide.value`

Tests: `npm test` (mocked model, fictional guide and credentials).

Preview check (no paid model call): `PREVIEW_PASSWORD=<password> node scripts/preview-check.mjs https://deploy-preview-N--<site>.netlify.app --guide /path/outside/repo/guide.json`
— confirms unauthenticated requests are refused, sign-in works, the function can read the private
guide (400 for a deliberately incomplete request; 503 means missing or unreadable), and the
published page contains no guide text (prints counts only).
