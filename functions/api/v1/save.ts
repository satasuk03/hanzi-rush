import { LIMITS, PUSH_IDS_KEPT, SAVE_FORMAT, sanitizeLook, sanitizeName, sanitizeTitle, type PutSaveResponse, type SaveConflictBody, type SaveDoc, type SaveResponse } from '../../../shared/api';
import { buildCard } from '../../../server/card';
import { authenticate } from '../../../server/auth';
import { ownedLook } from '../../../server/inventory';
import type { Ctx, Env } from '../../../server/env';
import { byMethod, fail, json, readJson } from '../../../server/http';
import { minInterval } from '../../../server/ratelimit';
import { validatePutSave } from '../../../server/validate';

async function readSave(ctx: Ctx, playerId: string): Promise<SaveResponse | null> {
  const r = await ctx.env.DB.prepare('SELECT revision, updated_at, data, push_ids FROM saves WHERE player_id = ?1').bind(playerId).first<{ revision: number; updated_at: number; data: string; push_ids: string }>();
  return r ? { revision: r.revision, updatedAt: r.updated_at, data: JSON.parse(r.data) as SaveDoc, pushIds: JSON.parse(r.push_ids || '[]') as string[] } : null;
}

export const onRequest: PagesFunction<Env> = async (ctx) =>
  byMethod(ctx.request, {
    GET: async () => {
      const me = await authenticate(ctx, true);
      const s = await readSave(ctx, me.id);
      if (!s) return fail('not_found', 'No cloud save yet');
      return json(s);
    },
    PUT: async () => {
      const me = await authenticate(ctx, true);
      const { value, bytes } = await readJson(ctx.request, LIMITS.maxSaveBytes);
      const req = validatePutSave(value);
      const db = ctx.env.DB;
      const now = Date.now();

      const cur = await db.prepare('SELECT revision, updated_at, push_ids FROM saves WHERE player_id = ?1').bind(me.id).first<{ revision: number; updated_at: number; push_ids: string }>();
      minInterval(cur?.updated_at, LIMITS.saveMinIntervalSec * 1000, now);

      const ids = JSON.stringify([...(JSON.parse(cur?.push_ids ?? '[]') as string[]), ...(req.pushId ? [req.pushId] : [])].slice(-PUSH_IDS_KEPT));
      const json_ = JSON.stringify(req.data);
      const name = sanitizeName(req.data.progress.profile.name);
      const title = sanitizeTitle(req.data.progress.profile.title);
      // saves from builds that predate looks carry none: keep what the player has
      const rawLook = req.data.progress.profile.look;
      const look = rawLook === undefined ? null : JSON.stringify(await ownedLook(db, me.id, sanitizeLook(rawLook)));
      // display-only numbers for the player card; a failure here never fails the save
      let card: string | null = null;
      try {
        card = JSON.stringify(buildCard(req.data));
      } catch {
        /* keep the previous card */
      }
      // No row yet: insert at revision 1 regardless of baseRevision (also recovers a client whose server row vanished).
      const write = cur
        ? db
            .prepare('UPDATE saves SET data = ?1, revision = revision + 1, format = ?2, bytes = ?3, updated_at = ?4, client_updated_at = ?5, push_ids = ?6 WHERE player_id = ?7 AND revision = ?8')
            .bind(json_, SAVE_FORMAT, bytes, now, req.clientUpdatedAt, ids, me.id, req.baseRevision)
        : db
            .prepare('INSERT INTO saves (player_id, revision, format, data, bytes, updated_at, client_updated_at, push_ids) VALUES (?1, 1, ?2, ?3, ?4, ?5, ?6, ?7) ON CONFLICT (player_id) DO NOTHING')
            .bind(me.id, SAVE_FORMAT, json_, bytes, now, req.clientUpdatedAt, ids);
      const newRev = cur ? req.baseRevision + 1 : 1;
      // name/title only follow a save that this very request wrote
      const profile = db
        .prepare('UPDATE players SET name = ?1, title = ?2, look = COALESCE(?6, look), card = COALESCE(?7, card) WHERE id = ?3 AND EXISTS (SELECT 1 FROM saves WHERE player_id = ?3 AND revision = ?4 AND updated_at = ?5)')
        .bind(name, title, me.id, newRev, now, look, card);
      const [w] = await db.batch([write, profile]);
      if (w.meta.changes === 0) {
        const current = await readSave(ctx, me.id);
        const body: Partial<SaveConflictBody> = { current: current! };
        return fail('save_conflict', 'Save changed on the server; merge and retry', { body });
      }
      const out: PutSaveResponse = { revision: newRev, updatedAt: now };
      return json(out);
    },
  });
