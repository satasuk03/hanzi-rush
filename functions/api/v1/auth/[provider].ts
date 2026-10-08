import { LIMITS } from '../../../../shared/api';
import { authenticate, parseDevice } from '../../../../server/auth';
import type { Env } from '../../../../server/env';
import { byMethod, fail, isObj, json, readJson } from '../../../../server/http';
import { parseProvider, signInOrLink } from '../../../../server/identity';
import { verifyCredential } from '../../../../server/oidc';
import { ipLimit } from '../../../../server/ratelimit';

export const onRequest: PagesFunction<Env> = async (ctx) =>
  byMethod(ctx.request, {
    POST: async () => {
      const provider = parseProvider(ctx.params.provider);
      await ipLimit(ctx, 'signin', LIMITS.signInPerIpPerHour);
      const { value } = await readJson(ctx.request, LIMITS.maxBodyBytes);
      const device = parseDevice(value);
      const credential = isObj(value) ? value.credential : null;
      if (typeof credential !== 'string' || !credential || credential.length > 8192) return fail('bad_request', 'credential required');
      // a stale or revoked token is not an error here: the caller is just not signed in
      const caller = await authenticate(ctx, false);
      const id = await verifyCredential(ctx.env, provider, credential);
      return json(await signInOrLink(ctx.env, caller, provider, id, device, Date.now()));
    },
  });
