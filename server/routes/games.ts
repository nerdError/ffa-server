import express, { Router } from 'express';
import os from 'node:os';
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { authenticate, anonClient } from '../../lib/auth.js';
import { logAction } from '../../lib/action-log.js';
import { supabaseAdmin } from '../../lib/supabase-admin.js';
import { cached } from '../../lib/cache.js';
import { recalculateAllRatings } from '../../lib/recalc.js';

export const gamesRouter = Router();

// TTL публичных данных игр (список/карточка). Сбрасывается при любой записи.
const GAMES_TTL_MS = 15_000;

// ============================================================
// Валидация участников
// ============================================================
interface GamePlayerInput {
    player_id: number;
    race: 'T' | 'Z' | 'P' | 'R';
    team?: number | null;
    is_winner?: boolean;
    eliminated_at?: number | null;
}

const VALID_RACES = ['T', 'Z', 'P', 'R'] as const;

function validatePlayers(input: unknown): string | null {
    if (!Array.isArray(input) || input.length === 0) {
        return 'players must be a non-empty array';
    }
    const seenIds = new Set<number>();
    for (const p of input as any[]) {
        if (!Number.isInteger(p?.player_id) || p.player_id <= 0) {
            return 'each player must have a valid player_id';
        }
        if (seenIds.has(p.player_id)) {
            return `duplicate player_id: ${p.player_id}`;
        }
        seenIds.add(p.player_id);
        if (!VALID_RACES.includes(p?.race)) {
            return `invalid race for player ${p.player_id}`;
        }
        if (p.is_winner !== undefined && typeof p.is_winner !== 'boolean') {
            return 'is_winner must be boolean';
        }
        if (p.eliminated_at !== undefined && p.eliminated_at !== null) {
            if (!Number.isInteger(p.eliminated_at) || p.eliminated_at < 1) {
                return 'eliminated_at must be a positive integer (>= 1)';
            }
        }
    }
    return null;
}

// ============================================================
// POST /api/games/parse-replay — разобрать .SC2Replay (модератор)
// ============================================================
interface ReplayPlayerSummary {
    name: string | null;
    race: string | null;
    result: string | null;
    teamId: number | null;
    toon: string | null;
    apm: number;
}

interface ReplaySummary {
    replayId: string;
    patchVersion: string;
    build: number | null;
    durationSeconds: number;
    playedAt: string | null;
    playedAtMs: number | null;
    gameType: string | null;
    mapTitle: string | null;
    replayType: string | null;
    players: ReplayPlayerSummary[];
}

interface EcoSample {
    seconds: number;
}

interface EcoTimelineResult {
    players?: Array<{ name?: string | null }>;
    timeline?: EcoSample[][];
}

interface ReplayLib {
    loadReplaySummary: (p: string) => Promise<ReplaySummary>;
    loadEcoTimeline: (p: string) => Promise<EcoTimelineResult>;
}

/**
 * Best-effort порядок выбывания: у выбывшего игрока tracker-статистика
 * прекращается раньше, чем заканчивается матч. Игроки, чьи события
 * продолжаются до самого конца, считаются дожившими (не выбывшими).
 * Возвращает map «имя игрока → номер выбывания» (1 = выбыл первым).
 */
function computeEliminationOrder(eco: EcoTimelineResult): Map<string, number> {
    const order = new Map<string, number>();
    const players = eco.players ?? [];
    const timelines = eco.timeline ?? [];
    if (players.length === 0 || timelines.length === 0) return order;

    const lasts = players.map((_, i) => {
        const tl = timelines[i] ?? [];
        return tl.length > 0 ? (tl[tl.length - 1]?.seconds ?? 0) : 0;
    });
    const endSeconds = Math.max(...lasts, 0);
    if (endSeconds <= 0) return order;

    // Погрешность дискретизации статистики + запас, чтобы «дожившие» не считались выбывшими
    const THRESHOLD_SECONDS = 30;
    const eliminated = players
        .map((p, i) => ({ name: p.name ?? null, seconds: lasts[i] ?? 0 }))
        .filter((x): x is { name: string; seconds: number } =>
            Boolean(x.name) && endSeconds - x.seconds > THRESHOLD_SECONDS)
        .sort((a, b) => a.seconds - b.seconds);

    eliminated.forEach((x, i) => order.set(x.name, i + 1));
    return order;
}

// SC2Replay начинается с user-data header "MPQ\x1B" (а "MPQ\x1A" — уже заголовок
// MPQ-архива внутри файла, по смещению). Принимаем оба варианта для совместимости.
const MPQ_MAGIC = Buffer.from([0x4d, 0x50, 0x51]); // "MPQ"
const MPQ_USER_DATA = 0x1b;
const MPQ_ARCHIVE = 0x1a;

// CJS-пакет парсера грузим через require (ESM-совместимо)
const nodeRequire = createRequire(import.meta.url);

/**
 * Нормализует название карты для сопоставления (trim, нижний регистр,
 * без расширения .sc2map).
 */
function normalizeMapName(name: string): string {
    return name.trim().toLowerCase().replace(/\.sc2map$/i, '');
}

/**
 * Ищет карту по основному ИЛИ альтернативному названию (нормализованно) среди
 * неудалённых. Новую карту НЕ создаёт: если не найдено — возвращает null, чтобы
 * форма предложила добавить вариацию названия существующей карте либо новую карту.
 */
async function findMap(
    client: any,
    name: string
): Promise<{ id: number; name: string; alt_name: string | null } | null> {
    const trimmed = name.trim();
    if (!trimmed) return null;
    const target = normalizeMapName(trimmed);

    const { data: maps, error } = await client
        .from('game_maps')
        .select('id, name, alt_name, deleted_at')
        .is('deleted_at', null);
    if (error) {
        console.warn('[games] map lookup failed:', error.message);
        return null;
    }
    const existing = (maps ?? []).find(
        (m: { id: number; name: string; alt_name: string | null }) =>
            normalizeMapName(m.name) === target ||
            (m.alt_name ? normalizeMapName(m.alt_name) === target : false)
    );
    return existing ?? null;
}

gamesRouter.post(
    '/parse-replay',
    express.raw({ type: 'application/octet-stream', limit: '25mb' }),
    async (req, res) => {
        const auth = await authenticate(req);
        if (!auth.ok) return res.status(auth.status).json({ error: auth.error });

        const { data: isMod } = await auth.client.rpc('is_moderator');
        if (!isMod) {
            return res.status(403).json({ error: 'Moderator access required' });
        }

        const buf = req.body as unknown;
        if (!Buffer.isBuffer(buf) || buf.length < 4) {
            return res.status(400).json({ error: 'Replay file is required' });
        }
        const signature = buf[3];
        if (!buf.subarray(0, 3).equals(MPQ_MAGIC) || (signature !== MPQ_USER_DATA && signature !== MPQ_ARCHIVE)) {
            return res.status(400).json({ error: 'Not a valid StarCraft II replay (MPQ) file' });
        }

        let rawName = String(req.headers['x-file-name'] ?? 'replay.SC2Replay');
        try {
            rawName = decodeURIComponent(rawName);
        } catch {
            // заголовок мог прийти не в percent-encoding — оставляем как есть
        }
        const safeName = rawName.replace(/[^\w.\-]+/g, '_').slice(-120) || 'replay.SC2Replay';
        const tmpPath = path.join(os.tmpdir(), `sc2rep-${randomUUID()}-${safeName}`);

        try {
            await fs.writeFile(tmpPath, buf);

            // CJS-пакет парсера — грузим лениво, чтобы не тянуть его без надобности
            const lib = nodeRequire('@replaysremastered/sc2readerjs') as ReplayLib;

            const summary = await lib.loadReplaySummary(tmpPath);

            // Если в реплее уже есть явный победитель (m_result = Win), порядок
            // выбывания не нужен, а eco-таймлайн — самая дорогая часть разбора.
            // Поэтому грузим его только как запасной вариант (last man standing),
            // когда явного результата нет. Параллельно ищем/создаём карту.
            const hasExplicitWin = summary.players.some(
                (p) => String(p.result ?? '').toLowerCase() === 'win'
            );
            const [eliminationOrder, map] = await Promise.all([
                hasExplicitWin
                    ? Promise.resolve(new Map<string, number>())
                    : lib
                        .loadEcoTimeline(tmpPath)
                        .then((eco) => computeEliminationOrder(eco))
                        .catch((e) => {
                            console.warn('[games] eco timeline failed:', e);
                            return new Map<string, number>();
                        }),
                summary.mapTitle
                    ? findMap(auth.client, summary.mapTitle)
                    : Promise.resolve(null),
            ]);

            res.json({
                replay: {
                    replayId: summary.replayId,
                    patchVersion: summary.patchVersion,
                    build: summary.build,
                    durationSeconds: summary.durationSeconds,
                    playedAt: summary.playedAt,
                    playedAtMs: summary.playedAtMs,
                    gameType: summary.gameType,
                    mapTitle: summary.mapTitle,
                    map,
                    replayType: summary.replayType,
                    players: summary.players.map((p) => ({
                        name: p.name,
                        race: p.race,
                        result: p.result,
                        teamId: p.teamId,
                        toon: p.toon,
                        eliminatedOrder: p.name ? (eliminationOrder.get(p.name) ?? null) : null,
                    })),
                },
            });
        } catch (err) {
            console.error('[games] replay parse error:', err);
            res.status(422).json({
                error: 'Failed to parse replay: ' + (err instanceof Error ? err.message : String(err)),
            });
        } finally {
            await fs.rm(tmpPath, { force: true }).catch(() => { });
        }
    }
);

// ============================================================
// GET /api/games — список игр (публичный)
// ============================================================
gamesRouter.get('/', async (req, res) => {
    const playerId = req.query.player_id ? Number(req.query.player_id) : null;
    const limit = Math.min(Number(req.query.limit ?? 50) || 50, 200);
    const offset = Math.max(Number(req.query.offset ?? 0) || 0, 0);

    try {
        const games = await cached(
            `pub:games:${playerId ?? 'all'}:${limit}:${offset}`,
            GAMES_TTL_MS,
            async () => {
                const client = anonClient();
                const { data, error } = await client.rpc('get_games_list', {
                    p_player_id: playerId,
                    p_limit: limit,
                    p_offset: offset,
                });
                if (error) throw error;
                return data ?? [];
            }
        );

        res.json({ games });
    } catch (error) {
        console.error('[games] list error:', error);
        res.status(500).json({ error: 'DB error' });
    }
});

// ============================================================
// GET /api/games/:id — одна игра (публичный)
// ============================================================
gamesRouter.get('/:id', async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
        return res.status(400).json({ error: 'Invalid game id' });
    }

    try {
        const game = await cached(`pub:game:${id}`, GAMES_TTL_MS, async () => {
            const client = anonClient();
            const { data, error } = await client.rpc('get_game_with_players', { p_id: id });
            if (error) throw error;
            return data;
        });

        if (!game) {
            return res.status(404).json({ error: 'Game not found' });
        }

        res.json({ game });
    } catch (error) {
        console.error('[games] get error:', error);
        res.status(500).json({ error: 'DB error' });
    }
});

// ============================================================
// POST /api/games — создать игру (модератор)
// ============================================================
/** Никнейм пользователя из profiles (best-effort). */
async function resolveUsername(userId: string): Promise<string | null> {
    try {
        const { data } = await supabaseAdmin
            .from('profiles')
            .select('username')
            .eq('user_id', userId)
            .maybeSingle();
        return data?.username ?? null;
    } catch {
        return null;
    }
}

gamesRouter.post('/', async (req, res) => {
    const auth = await authenticate(req);
    if (!auth.ok) return res.status(auth.status).json({ error: auth.error });

    const { data: isMod } = await auth.client.rpc('is_moderator');
    if (!isMod) {
        return res.status(403).json({ error: 'Moderator access required' });
    }

    const {
        played_at,
        format_id,
        host_id,
        map_id,
        mod_id,
        duration_min,
        notes,
        players,
        track_elim,
    } = req.body ?? {};

    if (typeof played_at !== 'string' || !played_at) {
        return res.status(400).json({ error: 'played_at is required' });
    }

    const playersError = validatePlayers(players);
    if (playersError) {
        return res.status(400).json({ error: playersError });
    }

    const hasWinner = (players as GamePlayerInput[]).some((p) => p.is_winner === true);
    if (!hasWinner) {
        return res.status(400).json({ error: 'At least one player must be a winner' });
    }

    const createdByUsername = await resolveUsername(auth.user.id);

    const { data, error } = await auth.client.rpc('create_game_with_players', {
        p_played_at: played_at,
        p_format_id: format_id ?? null,
        p_host_id: host_id ?? null,
        p_map_id: map_id ?? null,
        p_mod_id: mod_id ?? null,
        p_duration_min: duration_min ?? null,
        p_notes: notes ?? null,
        p_players: players,
        p_track_elim: track_elim ?? true,   // ← должно быть
        p_created_by_username: createdByUsername,
    });

    if (error) {
        console.error('[games] create error:', error);

        const msg = error.message ?? '';
        if (msg.includes('games_map_id_fkey')) {
            return res.status(400).json({ error: 'Map not found' });
        }
        if (msg.includes('games_format_id_fkey')) {
            return res.status(400).json({ error: 'Format not found' });
        }
        if (msg.includes('games_host_id_fkey')) {
            return res.status(400).json({ error: 'Host not found' });
        }
        if (msg.includes('games_mod_id_fkey')) {
            return res.status(400).json({ error: 'Mod not found' });
        }
        if (msg.includes('game_players_player_id_fkey')) {
            return res.status(400).json({ error: 'Player not found' });
        }

        return res.status(500).json({ error: 'DB error', details: error.message });
    }

    // Пересчитываем Elo после создания игры (вызовы склеиваются, ошибки логируются)
    await recalculateAllRatings();

    void logAction({
        action: 'game.create',
        actorId: auth.user.id,
        entityType: 'game',
        entityId: data,
        summary: `Добавлена игра #${data} (${(players as unknown[]).length} участников)`,
        details: {
            playerCount: (players as unknown[]).length,
            formatId: format_id ?? null,
            trackElim: track_elim ?? true,
        },
    });

    // Возвращаем полную игру с участниками
    const { data: fullGame, error: fetchError } = await auth.client.rpc(
        'get_game_with_players',
        { p_id: data }
    );

    if (fetchError) {
        return res.status(201).json({ game_id: data });
    }

    res.status(201).json({ game: fullGame });
});

// ============================================================
// PATCH /api/games/:id — обновить игру (модератор)
// ============================================================
gamesRouter.patch('/:id', async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
        return res.status(400).json({ error: 'Invalid game id' });
    }

    const auth = await authenticate(req);
    if (!auth.ok) return res.status(auth.status).json({ error: auth.error });

    const { data: isMod } = await auth.client.rpc('is_moderator');
    if (!isMod) {
        return res.status(403).json({ error: 'Moderator access required' });
    }

    // Редактировать игру может админ (любые) или модератор, добавивший её сам.
    const { data: isAdmin } = await auth.client.rpc('is_admin');
    if (!isAdmin) {
        const { data: game, error: fetchError } = await supabaseAdmin
            .from('games')
            .select('created_by')
            .eq('id', id)
            .maybeSingle();
        if (fetchError || !game || game.created_by !== auth.user.id) {
            return res.status(403).json({ error: 'You can only edit games you added' });
        }
    }

    const {
        played_at,
        format_id,
        host_id,
        map_id,
        mod_id,
        duration_min,
        notes,
        players,
        track_elim,
    } = req.body ?? {};

    if (typeof played_at !== 'string' || !played_at) {
        return res.status(400).json({ error: 'played_at is required' });
    }

    const playersError = validatePlayers(players);
    if (playersError) {
        return res.status(400).json({ error: playersError });
    }

    const hasWinner = (players as GamePlayerInput[]).some((p) => p.is_winner === true);
    if (!hasWinner) {
        return res.status(400).json({ error: 'At least one player must be a winner' });
    }

    const { error } = await auth.client.rpc('update_game_with_players', {
        p_game_id: id,
        p_played_at: played_at,
        p_format_id: format_id ?? null,
        p_host_id: host_id ?? null,
        p_map_id: map_id ?? null,
        p_mod_id: mod_id ?? null,
        p_duration_min: duration_min ?? null,
        p_notes: notes ?? null,
        p_players: players,
        p_track_elim: track_elim ?? true,   // ← должно быть
    });

    if (error) {
        console.error('[games] update error:', error);
        return res.status(500).json({ error: 'DB error', details: error.message });
    }

    // Пересчитываем Elo после обновления игры (вызовы склеиваются)
    await recalculateAllRatings();

    void logAction({
        action: 'game.update',
        actorId: auth.user.id,
        entityType: 'game',
        entityId: id,
        summary: `Изменена игра #${id} (${(players as unknown[]).length} участников)`,
        details: { playerCount: (players as unknown[]).length },
    });

    const { data: fullGame } = await auth.client.rpc('get_game_with_players', {
        p_id: id,
    });

    res.json({ game: fullGame });
});

// ============================================================
// DELETE /api/games/:id — удалить игру (модератор)
// ============================================================
gamesRouter.delete('/:id', async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
        return res.status(400).json({ error: 'Invalid game id' });
    }

    const auth = await authenticate(req);
    if (!auth.ok) return res.status(auth.status).json({ error: auth.error });

    // Удалять игры может только админ.
    const { data: isAdmin } = await auth.client.rpc('is_admin');
    if (!isAdmin) {
        return res.status(403).json({ error: 'Admin access required' });
    }

    const { data, error } = await auth.client
        .from('games')
        .delete()
        .eq('id', id)
        .select()
        .maybeSingle();

    if (error) {
        console.error('[games] delete error:', error);
        return res.status(500).json({ error: 'DB error' });
    }
    if (!data) {
        return res.status(404).json({ error: 'Game not found or not permitted' });
    }

    void logAction({
        action: 'game.delete',
        actorId: auth.user.id,
        entityType: 'game',
        entityId: id,
        summary: `Удалена игра #${id}`,
    });

    // Пересчитываем Elo после удаления игры (вызовы склеиваются)
    await recalculateAllRatings();

    res.json({ deleted: data });
});