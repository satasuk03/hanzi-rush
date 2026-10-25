/**
 * Continues: buy back one heart in a rush run (shared/api.ts CONTINUE). The ticket's `runs.continues` is the truth;
 * POST /runs accepts a submitted `continues` up to it.
 *
 * Payment is idempotent per (ticket, n): Jade only, a 'continue' ledger row with ref `${ticket}:${n}`, in the same
 * batch as the counter bump, which only moves when that ledger row exists. A replay finds the row and charges nothing.
 */
import { CONTINUE, LIMITS, continueCost, type ContinueResponse, type ContinueVia } from '../shared/api';
import { fail } from './http';
import { applyJade } from './wallet';

const TICKET_RE = /^[A-Za-z0-9_-]{8,64}$/;

interface RunRow {
  player_id: string;
  status: string;
  created_at: number;
  continues: number;
}

export interface ContinueOpts {
  now?: number;
}

const jadeRef = (ticket: string, n: number) => `${ticket}:${n}`;

export async function continueRun(db: D1Database, playerId: string, ticket: unknown, n: unknown, via: unknown, opts: ContinueOpts = {}): Promise<ContinueResponse> {
  if (typeof ticket !== 'string' || !TICKET_RE.test(ticket)) fail('bad_request', 'Invalid ticket');
  if (typeof n !== 'number' || !Number.isSafeInteger(n) || n < 1) fail('bad_request', 'Invalid n');
  if (via !== 'jade') fail('bad_request', 'Invalid via');
  const now = opts.now ?? Date.now();

  const run = await db.prepare('SELECT player_id, status, created_at, continues FROM runs WHERE id = ?1').bind(ticket).first<RunRow>();
  if (!run || run.player_id !== playerId) fail('ticket_invalid', 'Ticket is not valid for this run');

  // a replay: answer as the first time, whatever the run's state is now
  if (run.continues >= n) {
    const r = await paidBefore(db, playerId, ticket, n, via);
    if (r) return r;
    fail('continue_refused', 'Continue already used', { reason: 'sequence' });
  }
  if (run.status !== 'open' || now - run.created_at > LIMITS.ticketTtlMs) fail('continue_refused', 'Run is closed', { reason: 'closed' });
  if (n > CONTINUE.max) fail('continue_refused', 'No more continues', { reason: 'max' });
  if (run.continues !== n - 1) fail('continue_refused', 'Not the next continue', { reason: 'sequence' });

  const bump = (guard: string, ...args: unknown[]) =>
    db
      .prepare(`UPDATE runs SET continues = ?3 WHERE id = ?1 AND player_id = ?2 AND status = 'open' AND continues = ?3 - 1 AND ${guard}`)
      .bind(ticket, playerId, n, ...args);

  const cost = continueCost(n);
  const ref = jadeRef(ticket, n);
  const w = await applyJade(db, playerId, -cost, 'continue', ref, now, [
    bump("EXISTS (SELECT 1 FROM jade_ledger WHERE player_id = ?2 AND reason = 'continue' AND ref = ?4)", ref),
  ]);
  if (w.status === 'insufficient') fail('insufficient_jade', 'Not enough Jade', { body: { jade: w.jade } });
  return { n, via, cost: -w.delta, jade: w.jade, replay: w.status === 'replay' };
}

async function paidBefore(db: D1Database, playerId: string, ticket: string, n: number, via: ContinueVia): Promise<ContinueResponse | null> {
  const jade = (await db.prepare('SELECT jade FROM players WHERE id = ?1').bind(playerId).first<{ jade: number }>())?.jade ?? 0;
  const row = await db
    .prepare("SELECT delta FROM jade_ledger WHERE player_id = ?1 AND reason = 'continue' AND ref = ?2")
    .bind(playerId, jadeRef(ticket, n))
    .first<{ delta: number }>();
  return row ? { n, via, cost: -row.delta, jade, replay: true } : null;
}
