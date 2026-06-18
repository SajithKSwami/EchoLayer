// Benchmark corpus: a realistic multi-session coding project (24 episodes across 4 "sessions"),
// plus labeled queries with the ground-truth episode ids that genuinely answer them. Several
// queries target OLD sessions on purpose — that's where "dump recent history" falls down.

export const EPISODES = [
  // session 1 — setup + auth (oldest)
  { id: 'e01', text: 'Initialized the Next.js project and set up the folder structure', importance: 4, outcome: 'success' },
  { id: 'e02', text: 'Configured NextAuth with the Google OAuth provider for sign-in', importance: 7, outcome: 'success' },
  { id: 'e03', text: 'Stored auth secrets in .env.local and added it to .gitignore', importance: 5, outcome: 'success' },
  { id: 'e04', text: 'Wrote protected-route middleware to redirect unauthenticated users to login', importance: 6, outcome: 'success' },
  // session 2 — database
  { id: 'e05', text: 'Designed the Postgres schema for users, sessions, and applications tables', importance: 7, outcome: 'success' },
  { id: 'e06', text: 'Set up Prisma as the ORM and ran the first database migration', importance: 6, outcome: 'success' },
  { id: 'e07', text: 'Hit a Prisma connection-pool exhaustion error under concurrent load', importance: 9, outcome: 'fail' },
  { id: 'e08', text: 'Fixed pool exhaustion by adding connection limits and putting pgbouncer in front', importance: 8, outcome: 'success' },
  // session 3 — frontend
  { id: 'e09', text: 'Built the job-listing feed component with infinite scroll', importance: 5, outcome: 'success' },
  { id: 'e10', text: 'Added the quick-apply modal with optimistic UI updates', importance: 6, outcome: 'success' },
  { id: 'e11', text: 'The optimistic update caused a flicker when the apply API call failed', importance: 7, outcome: 'fail' },
  { id: 'e12', text: 'Fixed the flicker by rolling back optimistic state when the request errors', importance: 7, outcome: 'success' },
  { id: 'e13', text: 'Styled the feed with Tailwind using a bento-grid layout', importance: 3, outcome: 'success' },
  { id: 'e14', text: 'Added a database index on applications.user_id to speed up profile queries', importance: 6, outcome: 'success' },
  // session 4 — tests + deploy (most recent)
  { id: 'e15', text: 'Wrote integration tests for the application-submit flow', importance: 6, outcome: 'success' },
  { id: 'e16', text: 'Deployed to Vercel but the build failed due to a missing environment variable', importance: 8, outcome: 'fail' },
  { id: 'e17', text: 'Added GOOGLE_CLIENT_ID to the Vercel env and redeployed successfully', importance: 7, outcome: 'success' },
  { id: 'e18', text: 'Production threw CORS errors when the client called the API routes', importance: 9, outcome: 'fail' },
  { id: 'e19', text: 'Fixed CORS by setting allowed origins in the API route response headers', importance: 8, outcome: 'success' },
  { id: 'e20', text: 'Added rate limiting to the apply endpoint to prevent spam submissions', importance: 6, outcome: 'success' },
  { id: 'e21', text: 'Configured Sentry for error monitoring in production', importance: 5, outcome: 'success' },
  { id: 'e22', text: 'Set up a GitHub Action to run the test suite on every pull request', importance: 5, outcome: 'success' },
  { id: 'e23', text: 'Refactored auth middleware to share its guard logic with the API routes', importance: 5, outcome: 'success' },
  { id: 'e24', text: 'Wrote the project README with local setup instructions', importance: 3, outcome: 'success' },
];

export const QUERIES = [
  { q: 'how did we handle user authentication and sign-in?', relevant: ['e02', 'e04'] },
  { q: 'where are the auth secrets stored?', relevant: ['e03'] },
  { q: 'what caused the database performance problem and how was it fixed?', relevant: ['e07', 'e08'] },
  { q: 'how did we set up the ORM and run migrations?', relevant: ['e06'] },
  { q: 'how did we fix the optimistic UI flicker on failed requests?', relevant: ['e11', 'e12'] },
  { q: 'the production deployment failure', relevant: ['e16', 'e17'] },
  { q: 'CORS errors calling the API in production', relevant: ['e18', 'e19'] },
  { q: 'how do we run tests automatically on pull requests?', relevant: ['e22'] },
  { q: 'speeding up the application queries in the database', relevant: ['e14'] },
  { q: 'preventing spam on the apply endpoint', relevant: ['e20'] },
];
