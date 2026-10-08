import { parseBoardKey, type BoardResponse } from '../../../../shared/api';
import { myEntry, top, total } from '../../../../server/boards';
import { serveBoard } from '../../../../server/boardRoute';
import type { Env } from '../../../../server/env';
import { byMethod, fail } from '../../../../server/http';

export const onRequest: PagesFunction<Env> = async (ctx) =>
  byMethod(ctx.request, {
    GET: async () => {
      const raw = Array.isArray(ctx.params.board) ? ctx.params.board[0] : ctx.params.board;
      let boardStr = raw ?? '';
      try {
        boardStr = decodeURIComponent(boardStr);
      } catch {
        /* keep raw */
      }
      if (!parseBoardKey(boardStr)) return fail('bad_request', 'Unknown board');
      return serveBoard(
        ctx,
        {
          key: `board/${encodeURIComponent(boardStr)}`,
          shared: async (periodKey, limit) => {
            const [entries, n] = await Promise.all([top(ctx.env, boardStr, periodKey, limit, null), total(ctx.env, boardStr, periodKey)]);
            return { entries, total: n };
          },
          mine: (periodKey, playerId) => myEntry(ctx.env, boardStr, periodKey, playerId),
        },
        (page): BoardResponse => ({ board: boardStr as BoardResponse['board'], ...page }),
      );
    },
  });
