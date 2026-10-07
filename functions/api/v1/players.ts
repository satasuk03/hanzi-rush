import { LIMITS, type CreatePlayerResponse } from '../../../shared/api';
import { issueSession, parseDevice, randomPub, randomTag } from '../../../server/auth';
import type { Env } from '../../../server/env';
import { byMethod, json, readJson } from '../../../server/http';
import { ipLimit } from '../../../server/ratelimit';
import { uuid } from '../../../server/crypto';

export const onRequest: PagesFunction<Env> = async (ctx) =>
  byMethod(ctx.request, {
    POST: async () => {
      const ih = await ipLimit(ctx, 'create', LIMITS.createPerIpPerHour);
      const { value } = await readJson(ctx.request, LIMITS.maxBodyBytes);
      const device = parseDevice(value);
      const now = Date.now();
      const id = uuid();
      const tag = randomTag();
      const { token, stmt } = await issueSession(ctx.env, id, 'guest', device, now);
      // pub is unique (40 random bits); on the rare collision the whole batch fails, so try again with a new one
      for (let attempt = 0; ; attempt++) {
        try {
          await ctx.env.DB.batch([
            ctx.env.DB.prepare('INSERT INTO players (id, tag, pub, created_at, last_seen_at, created_ip_hash) VALUES (?1, ?2, ?5, ?3, ?3, ?4)').bind(id, tag, now, ih, randomPub()),
            stmt,
          ]);
          break;
        } catch (e) {
          if (attempt >= 2 || !/UNIQUE/i.test(String(e))) throw e;
        }
      }
      const body: CreatePlayerResponse = { playerId: id, token, tag, createdAt: now, save: null, recoveryCreatedAt: null };
      return json(body, 201);
    },
  });
