// Chronoworld: онлайн фаза 1 (docs/design/online.md). Один POST-эндпоинт { action, initData, ... }.
// Игрок — по подписи initData (секрет CHRONOWORLD_BOT_TOKEN). Таблицы cw_* закрыты RLS — пишем service role.
import { createClient } from 'npm:@supabase/supabase-js@2';
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

const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
  auth: { persistSession: false },
});

const SAVE_MAX = 512 * 1024;
const GIFTS_PER_DAY = 5;
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
    body = await req.json();
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
          await db.from('cw_player').insert({ ...profile, ...(started ? { bot_started: true } : {}), ref_by: inviter ? ref : null });
          if (inviter && ref) await addFriends(me, ref);
          fresh = true;
        } else {
          await db.from('cw_player').update(profile).eq('tg_id', me);
          // Повторный вход по ссылке друга — просто дружба (без реферальной награды).
          const ref = refFromStartParam(init.startParam, me);
          if (ref) {
            const { data: other } = await db.from('cw_player').select('tg_id').eq('tg_id', ref).maybeSingle();
            if (other) await addFriends(me, ref);
          }
        }
        const { data: save } = await db.from('cw_save').select('chapter, updated_at, save_version').eq('tg_id', me).maybeSingle();
        const { count: gifts } = await db.from('cw_gift').select('*', { count: 'exact', head: true }).eq('to_id', me).eq('claimed', false);
        const { data: p } = await db.from('cw_player').select('ref_bonus_pending').eq('tg_id', me).single();
        return json({ ok: true, id: me, name: profile.first_name, fresh, cloudSave: save ?? null, giftsWaiting: gifts ?? 0, refBonus: p?.ref_bonus_pending ?? 0 });
      }

      case 'save_get': {
        const { data } = await db.from('cw_save').select('data, save_version, chapter, updated_at').eq('tg_id', me).maybeSingle();
        return json({ ok: true, save: data ?? null });
      }

      case 'save_put': {
        const raw = JSON.stringify(body.data ?? null);
        if (!body.data || raw.length > SAVE_MAX) return json({ error: 'save_size' }, 413);
        await db.from('cw_save').upsert({
          tg_id: me,
          data: body.data,
          save_version: clampInt(body.saveVersion, 1000),
          chapter: clampInt(body.chapter, CAPS.chapter),
          updated_at: new Date().toISOString(),
        });
        return json({ ok: true });
      }

      case 'sync': {
        const chapter = clampInt(body.chapter, CAPS.chapter);
        const stage = clampInt(body.stage, CAPS.stage);
        const power = clampInt(body.power, CAPS.power);
        const tower = clampInt(body.towerBest, CAPS.tower);
        const mvp = clampInt(body.mvpWeek, CAPS.mvp);
        const { data: p } = await db.from('cw_player').select('chapter, stage, power, tower_best, ref_by, ref_rewarded').eq('tg_id', me).single();
        if (!p) return json({ error: 'no_player' }, 400);
        const upd: Record<string, unknown> = {
          chapter: Math.max(p.chapter, chapter),
          stage: chapter > p.chapter ? stage : Math.max(p.stage, stage),
          power: Math.max(p.power, power),
          tower_best: Math.max(p.tower_best, tower),
          last_seen: new Date().toISOString(),
          ...clientNotifyFields(body, Date.now()),
          comeback_stage: 0,
        };
        // Приглашённый прошёл главу 1 — награда пригласившему (забирает при следующем hello/ref_claim).
        if (p.ref_by && !p.ref_rewarded && (upd.chapter as number) >= 2) {
          upd.ref_rewarded = true;
          const { data: inv } = await db.from('cw_player').select('ref_bonus_pending').eq('tg_id', p.ref_by).maybeSingle();
          if (inv) await db.from('cw_player').update({ ref_bonus_pending: inv.ref_bonus_pending + 1 }).eq('tg_id', p.ref_by);
        }
        await db.from('cw_player').update(upd).eq('tg_id', me);
        const week = isoWeek(new Date());
        for (const [board, value] of [['tower', tower], ['mvp', mvp]] as const) {
          if (value <= 0) continue;
          const { data: cur } = await db.from('cw_score').select('value').match({ week, board, tg_id: me }).maybeSingle();
          if (!cur || value > Number(cur.value)) await db.from('cw_score').upsert({ week, board, tg_id: me, value, updated_at: new Date().toISOString() });
        }
        return json({ ok: true, refRewarded: upd.ref_rewarded === true });
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

      case 'gift_claim': {
        // Забрать колокольчики: не больше GIFTS_PER_DAY за день (остальные ждут завтра).
        const day = today();
        const { count: already } = await db.from('cw_gift').select('*', { count: 'exact', head: true }).eq('to_id', me).eq('claimed_on', day);
        const room = Math.max(0, GIFTS_PER_DAY - (already ?? 0));
        if (!room) return json({ ok: true, claimed: 0 });
        const { data: waiting } = await db.from('cw_gift').select('day, from_id').eq('to_id', me).eq('claimed', false).order('day', { ascending: false }).limit(room);
        for (const g of waiting ?? []) await db.from('cw_gift').update({ claimed: true, claimed_on: day }).match({ day: g.day, from_id: g.from_id, to_id: me });
        return json({ ok: true, claimed: (waiting ?? []).length });
      }

      case 'ref_claim': {
        const { data: p } = await db.from('cw_player').select('ref_bonus_pending').eq('tg_id', me).single();
        const n = p?.ref_bonus_pending ?? 0;
        if (n > 0) await db.from('cw_player').update({ ref_bonus_pending: 0 }).eq('tg_id', me);
        return json({ ok: true, claimed: n });
      }

      default:
        return json({ error: 'unknown_action' }, 400);
    }
  } catch (e) {
    console.error('cw-api', action, e);
    return json({ error: 'server' }, 500);
  }
});
