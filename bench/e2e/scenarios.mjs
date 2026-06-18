// End-to-end A/B scenarios. Each has a small real workspace, a task that depends on a non-obvious
// past decision, and the memory an agent WOULD have had. Cold condition: the agent must explore
// the workspace to recover the decision. EchoLayer condition: the decision is recalled up front.
// Tune/extend these against your own projects for a publishable number.

export const SCENARIOS = [
  {
    name: 'db-connection-strategy',
    query: 'how should new database-heavy code connect to Postgres?',
    task:
      'Add a new module reportQueries.js that runs a heavy aggregate report against Postgres. ' +
      'Follow this project\'s existing database connection strategy. Briefly state the strategy you followed and why.',
    files: {
      'package.json': '{\n  "name": "jobs-app",\n  "type": "module",\n  "dependencies": { "pg": "^8.11.0" }\n}\n',
      'db.js':
        "import pg from 'pg';\n" +
        "// Pool sizing is intentionally conservative — see infra notes.\n" +
        "export const pool = new pg.Pool({ max: 10, connectionString: process.env.DATABASE_URL });\n",
      'infra/notes.md':
        '# Infra notes\n\n- Postgres sits behind **pgbouncer** (transaction pooling).\n' +
        '- App pool capped at `max: 10` per instance to avoid exhausting server connections.\n',
    },
    memory: [
      { id: 'm1', text: 'Hit a Postgres connection-pool exhaustion error under concurrent load', importance: 9, outcome: 'fail' },
      { id: 'm2', text: 'Fixed pool exhaustion by capping the app pool at max:10 and putting pgbouncer (transaction pooling) in front', importance: 8, outcome: 'success' },
      { id: 'm3', text: 'Designed the Postgres schema for users, sessions, and applications', importance: 6, outcome: 'success' },
    ],
  },
  {
    name: 'production-api-cors',
    query: 'what do new API routes need to work in production from the browser?',
    task:
      'Add a new API route handler notifications.js that the frontend will fetch from the browser. ' +
      'Make sure it will work in production. Briefly note any production gotcha you accounted for.',
    files: {
      'package.json': '{\n  "name": "jobs-app",\n  "type": "module"\n}\n',
      'api/apply.js':
        "export function handler(req, res) {\n" +
        "  res.setHeader('Access-Control-Allow-Origin', 'https://app.jobs.example');\n" +
        "  res.json({ ok: true });\n}\n",
    },
    memory: [
      { id: 'm1', text: 'Production threw CORS errors when the client called API routes from the browser', importance: 9, outcome: 'fail' },
      { id: 'm2', text: 'Fixed CORS by setting Access-Control-Allow-Origin to the app origin in each API route response header', importance: 8, outcome: 'success' },
    ],
  },
];
