// Chronoworld: онлайн фаза 1 (docs/design/online.md). Один POST-эндпоинт { action, initData, ... }.
// Игрок — по подписи initData (секрет CHRONOWORLD_BOT_TOKEN). Таблицы cw_* закрыты RLS — пишем service role.
import { createClient } from 'npm:@supabase/supabase-js@2.99.2';
import { checkedDatabase } from '../_shared/database.ts';
import { isoWeek, refFromStartParam, verifyInitData } from './tg.ts';
import { clientNotifyFields } from '../_shared/bot.ts';
import {
  BOARD_TOP,
  betterFilter,
  boardKind,
  boardMine,
  boardRows,
  boardScope,
  FRIENDS_MAX,
  isWeekly,
  PLAYER_COLS,
  playerEntry,
  rankBoard,
  rankTop,
  type Entry,
  type PlayerRow,
  type Ranked,
} from './boards.ts';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });
const rpcJson = (body: unknown, errorStatus = 400) => {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('Invalid database RPC response');
  const value = body as { ok?: boolean; error?: string };
  if (value.ok === true) return json(body);
  if (typeof value.error === 'string') return json(body, value.error === 'save_size' ? 413 : errorStatus);
  throw new Error('Invalid database RPC result');
};

const db = checkedDatabase(createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
  auth: { persistSession: false },
}));

const SAVE_MAX = 512 * 1024;
const CAPS = { chapter: 10, stage: 18, power: 50_000_000, tower: 2000, mvp: 5_000_000_000 };
const clampInt = (v: unknown, max: number) => {
  const n = Math.floor(Number(v));
  return Number.isFinite(n) ? Math.max(0, Math.min(max, n)) : 0;
};
const today = () => new Date().toISOString().slice(0, 10);

async function friendIds(me: number): Promise<number[]> {
  const { data } = await db.from('cw_friend').select('b').eq('a', me);
  return (data ?? []).map((r) => Number(r.b));
}

async function addFriends(a: number, b: number) {
  await db.from('cw_friend').upsert([{ a, b }, { a: b, b: a }], { onConflict: 'a,b', ignoreDuplicates: true });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'method' }, 405);
  let body: Record<string, unknown>;
  try {
    const value: unknown = await req.json();
    if (!value || typeof value !== 'object' || Array.isArray(value)) return json({ error: 'bad_json' }, 400);
    body = value as Record<string, unknown>;
  } catch {
    return json({ error: 'bad_json' }, 400);
  }
  const init = await verifyInitData(String(body.initData ?? ''), Deno.env.get('CHRONOWORLD_BOT_TOKEN') ?? '', Math.floor(Date.now() / 1000));
  if (!init) return json({ error: 'unauthorized' }, 401);
  const me = init.user.id;
  const action = String(body.action ?? '');

  try {
    switch (action) {
      case 'hello': {
        const { data: existing } = await db.from('cw_player').select('*').eq('tg_id', me).maybeSingle();
        const profile = {
          tg_id: me,
          first_name: (init.user.first_name ?? '').slice(0, 64),
          username: init.user.username?.slice(0, 64) ?? null,
          lang: init.user.language_code?.slice(0, 8) ?? null,
          last_seen: new Date().toISOString(),
          // Бот и уведомления (_shared/bot.ts): часовой пояс, когда сундук полон и отряд вернётся; игрок в игре —
          // «возвращайся» начинается заново, колокольчики он видит сам.
          ...clientNotifyFields(body, Date.now()),
          comeback_stage: 0,
          gift_at: null,
          // Разрешил боту писать (initData user.allows_write_to_pm) — уведомления можно слать.
          ...(init.user.allows_write_to_pm ? { bot_started: true } : {}),
        };
        let fresh = false;
        if (!existing) {
          const ref = refFromStartParam(init.startParam, me);
          const { data: inviter } = ref ? await db.from('cw_player').select('tg_id').eq('tg_id', ref).maybeSingle() : { data: null };
          // Нажал Start в боте раньше, чем открыл игру (cw_bot_start пишет cw-bot).
          const { data: started } = await db.from('cw_bot_start').select('tg_id').eq('tg_id', me).maybeSingle();
          // Два одновременных hello не конфликтуют по PK и не меняют уже назначенного пригласившего.
          const { data: inserted } = await db.from('cw_player').upsert({ ...profile, ...(started ? { bot_started: true } : {}), ref_by: inviter ? ref : null }, { onConflict: 'tg_id', ignoreDuplicates: true }).select('tg_id');
          fresh = !!inserted?.length;
          if (!fresh) await db.from('cw_player').update(profile).eq('tg_id', me);
          if (inviter && ref) await addFriends(me, ref);
        } else {
          await db.from('cw_player').update(profile).eq('tg_id', me);
          // Повторный вход по ссылке друга — просто дружба (без реферальной награды).
          const ref = refFromStartParam(init.startParam, me);
          if (ref) {
            const { data: other } = await db.from('cw_player').select('tg_id').eq('tg_id', ref).maybeSingle();
            if (other) await addFriends(me, ref);
          }
        }
        const { data: save } = await db.from('cw_save').select('chapter, updated_at, save_version, write_revision').eq('tg_id', me).maybeSingle();
        const { count: gifts } = await db.from('cw_gift').select('*', { count: 'exact', head: true }).eq('to_id', me).eq('claimed', false);
        const { data: p } = await db.from('cw_player').select('ref_bonus_pending').eq('tg_id', me).single();
        return json({ ok: true, protocol: 2, id: me, name: profile.first_name, fresh, cloudSave: save ?? null, giftsWaiting: gifts ?? 0, refBonus: p?.ref_bonus_pending ?? 0 });
      }

      case 'save_get': {
        const { data } = await db.rpc('cw_save_get', { p_tg_id: me });
        return rpcJson(data);
      }

      case 'save_put': {
        const raw = JSON.stringify(body.data ?? null);
        if (!body.data || typeof body.data !== 'object' || Array.isArray(body.data) || new TextEncoder().encode(raw).length > SAVE_MAX) return json({ error: 'save_size' }, 413);
        const revision = body.expectedRevision;
        if (revision !== undefined && (!Number.isSafeInteger(revision) || Number(revision) < 0)) return json({ error: 'bad_revision' }, 400);
        const writeId = body.writeId;
        if (writeId !== undefined && (typeof writeId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(writeId))) return json({ error: 'bad_write_id' }, 400);
        const { data } = await db.rpc('cw_save_put', {
          p_tg_id: me, p_data: body.data, p_save_version: clampInt(body.saveVersion, 1000),
          p_chapter: clampInt(body.chapter, CAPS.chapter), p_expected_revision: revision ?? null, p_write_id: writeId ?? null,
        });
        return rpcJson(data, 409);
      }

      case 'sync': {
        const chapter = clampInt(body.chapter, CAPS.chapter);
        const stage = clampInt(body.stage, CAPS.stage);
        const power = clampInt(body.power, CAPS.power);
        const tower = clampInt(body.towerBest, CAPS.tower);
        const week = isoWeek(new Date());
        // Пожизненный towerBest — профиль. Без фактического результата текущей недели доска не заполняется.
        const towerWeek = body.towerWeekId === week ? clampInt(body.towerWeek, CAPS.tower) : 0;
        // Новый клиент сообщает неделю результата; устаревший отложенный запрос не переносит рекорд в новую неделю.
        const mvp = body.mvpWeekId === undefined || body.mvpWeekId === week ? clampInt(body.mvpWeek, CAPS.mvp) : 0;
        const { data } = await db.rpc('cw_sync_player', {
          p_tg_id: me, p_chapter: chapter, p_stage: stage, p_power: power, p_tower: tower,
          p_tower_week: towerWeek, p_mvp: mvp, p_week: week, p_notify: clientNotifyFields(body, Date.now()),
        });
        return rpcJson(data);
      }

      case 'board': {
        // Доски (boards.ts): недельные tower/mvp — cw_score; постоянные power/progress — cw_player. Топ-50 + моё место;
        // в строках — имя, значение, глава, этап, сила (старый клиент читает place/name/value/me).
        const board = boardKind(body.board);
        const scope = boardScope(body.scope);
        const week = isoWeek(new Date());
        const ids = scope === 'friends' ? [me, ...(await friendIds(me)).slice(0, FRIENDS_MAX)] : null;
        let ranked: { top: Ranked[]; mine: Ranked | null };
        let players: PlayerRow[] = [];
        if (isWeekly(board)) {
          const scores = () => db.from('cw_score').select('tg_id, value').eq('week', week).eq('board', board);
          const toEntry = (r: { tg_id: unknown; value: unknown }): Entry => ({ id: Number(r.tg_id), value: Number(r.value) });
          if (ids) {
            const { data } = await scores().in('tg_id', ids);
            ranked = rankBoard((data ?? []).map(toEntry), me);
          } else {
            const { data } = await scores().order('value', { ascending: false }).order('tg_id', { ascending: true }).limit(BOARD_TOP);
            const { data: my } = await db.from('cw_score').select('tg_id, value').match({ week, board, tg_id: me }).maybeSingle();
            let better: number | null = null;
            if (my) {
              const { count } = await db.from('cw_score').select('*', { count: 'exact', head: true }).eq('week', week).eq('board', board).gt('value', my.value);
              better = count ?? 0;
            }
            ranked = rankTop((data ?? []).map(toEntry), me, my ? toEntry(my) : null, better);
          }
          const need = [...new Set([me, ...ranked.top.map((r) => r.id)])];
          const { data: ps } = await db.from('cw_player').select(PLAYER_COLS).in('tg_id', need);
          players = (ps ?? []) as PlayerRow[];
        } else {
          const kind = board as 'power' | 'progress';
          const entries = (rows: PlayerRow[]) => rows.map((p) => playerEntry(kind, p)).filter((e): e is Entry => e !== null);
          if (ids) {
            const { data } = await db.from('cw_player').select(PLAYER_COLS).in('tg_id', ids);
            players = (data ?? []) as PlayerRow[];
            ranked = rankBoard(entries(players), me);
          } else {
            let q = db.from('cw_player').select(PLAYER_COLS);
            q = kind === 'power'
              ? q.gt('power', 0).order('power', { ascending: false })
              : q.gt('chapter', 0).order('chapter', { ascending: false }).order('stage', { ascending: false }).order('power', { ascending: false });
            const { data } = await q.order('tg_id', { ascending: true }).limit(BOARD_TOP);
            const { data: myRow } = await db.from('cw_player').select(PLAYER_COLS).eq('tg_id', me).maybeSingle();
            const myEntry = myRow ? playerEntry(kind, myRow as PlayerRow) : null;
            let better: number | null = null;
            if (myEntry) {
              const { count } = await db.from('cw_player').select('*', { count: 'exact', head: true }).or(betterFilter(kind, myRow as PlayerRow));
              better = count ?? 0;
            }
            players = [...((data ?? []) as PlayerRow[]), ...(myRow ? [myRow as PlayerRow] : [])];
            ranked = rankTop(entries((data ?? []) as PlayerRow[]), me, myEntry, better);
          }
        }
        const top = boardRows(ranked.top, players, me);
        const mine = boardMine(ranked.mine, players.find((p) => Number(p.tg_id) === me));
        return json({ ok: true, board, scope, week: isWeekly(board) ? week : '', top, mine });
      }

      case 'friends': {
        const ids = await friendIds(me);
        if (!ids.length) return json({ ok: true, friends: [] });
        const day = today();
        const [{ data: ps }, { data: sent }, { data: got }] = await Promise.all([
          db.from('cw_player').select(`${PLAYER_COLS}, last_seen`).in('tg_id', ids),
          db.from('cw_gift').select('to_id').eq('day', day).eq('from_id', me),
          db.from('cw_gift').select('from_id').eq('to_id', me).eq('claimed', false),
        ]);
        const sentSet = new Set((sent ?? []).map((g) => Number(g.to_id)));
        const gotSet = new Set((got ?? []).map((g) => Number(g.from_id)));
        const friends = (ps ?? []).map((p) => ({
          id: Number(p.tg_id), name: p.first_name, chapter: p.chapter, stage: p.stage, power: Number(p.power) || 0, towerBest: p.tower_best, lastSeen: p.last_seen,
          giftSent: sentSet.has(Number(p.tg_id)), giftWaiting: gotSet.has(Number(p.tg_id)),
        }));
        return json({ ok: true, friends });
      }

      case 'gift_send': {
        const to = Number(body.to);
        if (!(await friendIds(me)).includes(to)) return json({ error: 'not_friend' }, 400);
        await db.from('cw_gift').upsert({ day: today(), from_id: me, to_id: to }, { onConflict: 'day,from_id,to_id', ignoreDuplicates: true });
        // Уведомление получателю (cw-cron: не чаще раза в день, не ночью). Отметка — время первого незамеченного.
        await db.from('cw_player').update({ gift_at: new Date().toISOString() }).eq('tg_id', to).is('gift_at', null);
        return json({ ok: true });
      }

      case 'gift_claim':
      case 'ref_claim':
      case 'reward_claim': {
        // Старый клиент не умеет сохранять ID grant: повторный ответ мог бы удвоить выдачу.
        if (body.protocol !== 2) return json({ error: 'upgrade_required' }, 409);
        const kind = action === 'gift_claim' ? 'gift' : action === 'ref_claim' ? 'ref' : 'all';
        const { data } = await db.rpc('cw_claim_rewards', { p_tg_id: me, p_kind: kind });
        return rpcJson(data);
      }

      default:
        return json({ error: 'unknown_action' }, 400);
    }
  } catch (e) {
    console.error('cw-api', action, e);
    return json({ error: 'server' }, 500);
  }
});
