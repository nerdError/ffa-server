import { apiRequest, ApiRequestError } from '../api';
import { STAT_ORDER } from '../radar';
import { state } from '../state';
import { navigateTo } from '../router';
import {
    RACES,
    type GivenRating,
    type GivenRatingsResponse,
    type MyRating,
    type MyRatingResponse,
    type Race,
    type Rating,
    type RatingsListResponse,
    type RatingInput,
} from '../types';
import terranIcon from '../../assets/race/terran.svg';
import zergIcon from '../../assets/race/zerg.svg';
import protossIcon from '../../assets/race/protoss.svg';

import randomIcon from '../../assets/race/random.svg';
import { applyTranslations, onLocaleChange, t } from '../i18n';

onLocaleChange(() => {
    applyTranslations();
});

const RACE_ICONS: Record<Race, string> = {
    T: terranIcon,
    Z: zergIcon,
    P: protossIcon,
    R: randomIcon,
};

const RACE_LABELS: Record<Race, string> = {
    T: 'Terran',
    Z: 'Zerg',
    P: 'Protoss',
    R: 'Random',
};
const LEVEL_LETTERS: Record<number, string> = {
    1: 'E', 2: 'D', 3: 'C', 4: 'B', 5: 'A',
};

// function statPill(value: number | null): HTMLSpanElement {
//     const span = document.createElement('span');
//     if (value === null || value === undefined) {
//         span.className = 'stat-pill stat-empty';
//         span.textContent = '—';
//         return span;
//     }
//     const rounded = Math.round(Number(value));
//     span.className = `stat-pill stat-${Math.min(5, Math.max(1, rounded))}`;
//     span.textContent = Number(value).toFixed(2);
//     return span;
// }

// --- API-запрос своей оценки ---
async function fetchMyRating(playerId: number): Promise<MyRating | null> {
    try {
        const res = await apiRequest<MyRatingResponse>(
            `/api/players/${playerId}/my-rating`,
            { token: state.token }
        );
        return res.rating;
    } catch (err) {
        if (err instanceof ApiRequestError && err.status === 401) return null;
        console.warn('[ratings] my-rating failed:', err);
        return null;
    }
}

// ============================================================
// Режим ПРОСМОТРА: кнопка «Оценить/Изменить»
// ============================================================
export async function renderRatingButton(
    playerId: number,
    onStartEdit: (initial: RatingInput) => void,
    onDeleted: () => void
): Promise<void> {
    const container = document.getElementById('rating-form-container');
    if (!container) return;

    container.innerHTML = '';

    // Если не залогинен — показываем сообщение
    if (!state.token) {
        const card = document.createElement('div');
        card.className = 'card rating-card';
        card.innerHTML =
            '<p class="hint">Войдите, чтобы оценивать игроков.</p>';
        container.appendChild(card);
        return;
    }

    // Есть ли у пользователя своя оценка?
    const mine = await fetchMyRating(playerId);

    const card = document.createElement('div');
    card.className = 'card rating-card';

    const actions = document.createElement('div');
    actions.className = 'rating-view-actions';

    // --- Кнопка «Оценить/Изменить» ---
    const editBtn = document.createElement('button');
    editBtn.type = 'button';
    editBtn.className = 'btn-primary rating-start-btn';

    editBtn.dataset.i18n = mine ? "player.rating_edit" : "player.rating_add";
    editBtn.textContent = mine ? `✎ ${t("player.rating_edit")}` : `+ ${t("player.rating_add")}`;

    editBtn.addEventListener('click', () => {
        const initial: RatingInput = mine
            ? {
                race: mine.race,
                adaptiveness: mine.adaptiveness,
                greed: mine.greed,
                survival: mine.survival,
                turtle: mine.turtle,
                aggression: mine.aggression,
                variety: mine.variety,
            }
            : {
                race: 'T',
                adaptiveness: 3,
                greed: 3,
                survival: 3,
                turtle: 3,
                aggression: 3,
                variety: 3,
            };
        onStartEdit(initial);
    });

    actions.appendChild(editBtn);

    // --- Кнопка «Удалить мою оценку» (только если оценка есть) ---
    if (mine) {
        const delBtn = document.createElement('button');
        delBtn.type = 'button';
        delBtn.className = 'btn-danger rating-delete-btn';
        
        delBtn.dataset.i18n = "player.rating_delete";
        delBtn.textContent = `🗑 ${t("player.rating_delete")}`;

        delBtn.addEventListener('click', () => {
            void (async () => {
                if (!confirm(t("player.rating_delete_confirm"))) {
                    return;
                }
                try {
                    delBtn.disabled = true;

                    delBtn.dataset.i18n = "common.deleting"
                    delBtn.textContent = `${t("common.deleting")}`;

                    await apiRequest(`/api/players/${playerId}/my-rating`, {
                        method: 'DELETE',
                        token: state.token,
                    });

                    onDeleted();
                } catch (err) {
                    delBtn.disabled = false;

                    delBtn.dataset.i18n = "player.rating_delete"
                    delBtn.textContent = `🗑 ${t("player.rating_delete")}`;
                    
                    alert(
                        'Не удалось удалить: ' +
                        (err instanceof Error ? err.message : String(err))
                    );
                }
            })();
        });

        actions.appendChild(delBtn);
    }

    card.appendChild(actions);
    container.appendChild(card);
}
// ============================================================
// Режим РЕДАКТИРОВАНИЯ: слайдеры, кнопки «Сохранить»/«Отмена»
// ============================================================
export function renderRatingEditor(
    initial: RatingInput,
    onChange: (draft: RatingInput) => void
): void {
    const container = document.getElementById('rating-form-container');
    if (!container) return;

    container.innerHTML = '';

    const form = document.createElement('form');
    form.className = 'rating-form';
    form.addEventListener('submit', (e) => e.preventDefault());

    // --- Раса ---
    let currentRace: Race = initial.race;

    const raceSection = document.createElement('div');
    raceSection.className = 'rating-race-section';

    const raceRow = document.createElement('div');
    raceRow.className = 'rating-race-row';

    for (const r of RACES) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = `race-toggle race-toggle-${r}`;
        btn.dataset.race = r;
        if (r === currentRace) btn.classList.add('active');

        const img = document.createElement('img');
        img.src = RACE_ICONS[r];
        img.alt = RACE_LABELS[r];
        img.title = RACE_LABELS[r];
        img.className = 'race-toggle-icon';
        btn.appendChild(img);

        btn.addEventListener('click', () => {
            currentRace = r;
            raceRow.querySelectorAll('.race-toggle').forEach((el) => {
                el.classList.toggle(
                    'active',
                    (el as HTMLElement).dataset.race === r
                );
            });
            emitChange();
        });
        raceRow.appendChild(btn);
    }
    raceSection.appendChild(raceRow);
    form.appendChild(raceSection);

    // --- Слайдеры ---
    const slidersSection = document.createElement('div');
    slidersSection.className = 'rating-sliders-section';

    const sliders: Record<string, HTMLInputElement> = {};

    for (const axis of STAT_ORDER) {
        const row = document.createElement('div');
        row.className = 'slider-row';
        row.style.setProperty('--stat-color', axis.color);

        const labelWrap = document.createElement('div');
        labelWrap.className = 'slider-label-wrap';

        const label = document.createElement('label');
        label.className = 'slider-label';
        label.dataset.i18n = axis.langKey;
        label.textContent = axis.getStr();
        label.htmlFor = `slider-${axis.key}`;

        const value = document.createElement('output');
        value.className = 'slider-value';

        labelWrap.append(label, value);

        const input = document.createElement('input');
        input.type = 'range';
        input.id = `slider-${axis.key}`;
        input.name = axis.key;
        input.min = '1';
        input.max = '5';
        input.step = '1';
        input.value = String(initial[axis.key]);
        input.className = 'slider';

        const updateOutput = () => {
            const v = Number(input.value);
            const min = Number(input.min);
            const max = Number(input.max);
            const pct = ((v - min) / (max - min)) * 100;
            input.style.setProperty('--fill', `${pct}%`);
            value.textContent = `${v} · ${LEVEL_LETTERS[v] ?? '?'}`;
        };
        updateOutput();

        input.addEventListener('input', () => {
            updateOutput();
            emitChange();
        });

        sliders[axis.key] = input;
        row.append(labelWrap, input);
        slidersSection.appendChild(row);
    }

    form.appendChild(slidersSection);
    container.appendChild(form);

    function collectDraft(): RatingInput {
        return {
            race: currentRace,
            adaptiveness: Number(sliders.adaptiveness?.value ?? 3),
            greed: Number(sliders.greed?.value ?? 3),
            survival: Number(sliders.survival?.value ?? 3),
            turtle: Number(sliders.turtle?.value ?? 3),
            aggression: Number(sliders.aggression?.value ?? 3),
            variety: Number(sliders.variety?.value ?? 3),
        };
    }

    function emitChange(): void {
        onChange(collectDraft());
    }

    // Первичный emit
    emitChange();
}

/**
 * Кнопка удаления оценки для админа. Возвращает null, если текущий
 * пользователь не админ.
 */
function buildAdminDeleteButton(
    ratingId: number,
    onDeleted: () => void
): HTMLButtonElement | null {
    if (!state.user?.is_admin) return null;

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'rating-admin-delete';
    btn.textContent = '🗑';
    btn.title = t('ratings.admin_delete');
    btn.setAttribute('aria-label', t('ratings.admin_delete'));

    btn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        void (async () => {
            if (!confirm(t('ratings.admin_delete_confirm'))) return;
            btn.disabled = true;
            try {
                await apiRequest(`/api/admin/ratings/${ratingId}`, {
                    method: 'DELETE',
                    token: state.token,
                });
                onDeleted();
            } catch (err) {
                btn.disabled = false;
                alert(
                    `${t('ratings.admin_delete_error')}: ` +
                    (err instanceof Error ? err.message : String(err))
                );
            }
        })();
    });

    return btn;
}

/**
 * Кнопка «Удалить все» для админа. Возвращает null для не-админов.
 */
function buildAdminDeleteAllButton(
    endpoint: string,
    confirmText: string,
    onDeleted: () => void
): HTMLButtonElement | null {
    if (!state.user?.is_admin) return null;

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'btn-danger rating-admin-delete-all';
    btn.textContent = t('ratings.admin_delete_all');

    btn.addEventListener('click', () => {
        void (async () => {
            if (!confirm(confirmText)) return;
            btn.disabled = true;
            try {
                await apiRequest(endpoint, {
                    method: 'DELETE',
                    token: state.token,
                });
                onDeleted();
            } catch (err) {
                btn.disabled = false;
                alert(
                    `${t('ratings.admin_delete_error')}: ` +
                    (err instanceof Error ? err.message : String(err))
                );
            }
        })();
    });

    return btn;
}

// ============================================================
// Список оценок, поставленных самим игроком
// (показываем только если игрок связан с профилем)
// ============================================================
export async function renderGivenRatingsList(
    playerId: number,
    isLinked: boolean,
    onDeleted?: () => void
): Promise<void> {
    const container = document.getElementById('given-ratings-container');
    if (!container) return;
    container.innerHTML = '';

    if (!isLinked) return;

    let ratings: GivenRating[] = [];
    try {
        const res = await apiRequest<GivenRatingsResponse>(
            `/api/players/${playerId}/given-ratings`
        );
        ratings = res.ratings;
    } catch {
        return;
    }

    const card = document.createElement('div');
    card.className = 'card ratings-list ratings-list--given fade-in';

    const header = document.createElement('div');
    header.className = 'ratings-list-header';

    const h3 = document.createElement('h3');
    h3.textContent = t('ratings.given_title');
    header.appendChild(h3);

    if (ratings.length > 0) {
        const deleteAll = buildAdminDeleteAllButton(
            `/api/admin/players/${playerId}/given-ratings`,
            t('ratings.admin_delete_all_given_confirm'),
            () => onDeleted?.()
        );
        if (deleteAll) header.appendChild(deleteAll);
    }

    card.appendChild(header);

    if (ratings.length === 0) {
        const p = document.createElement('p');
        p.className = 'hint';
        p.textContent = t('ratings.given_empty');
        card.appendChild(p);
        container.appendChild(card);
        return;
    }

    const table = document.createElement('table');
    const thead = document.createElement('thead');
    const headRow = document.createElement('tr');

    const thPlayer = document.createElement('th');
    thPlayer.textContent = t('ratings.col.player');
    headRow.appendChild(thPlayer);

    const thRace = document.createElement('th');
    thRace.textContent = t('ratings.col.race');
    headRow.appendChild(thRace);

    for (const axis of STAT_ORDER) {
        const th = document.createElement('th');
        th.dataset.i18n = axis.langKey;
        th.textContent = axis.getStr();
        headRow.appendChild(th);
    }
    thead.appendChild(headRow);
    table.appendChild(thead);

    const tbody = document.createElement('tbody');
    for (const r of ratings) {
        const tr = document.createElement('tr');

        const tdPlayer = document.createElement('td');
        if (r.player_name) {
            const link = document.createElement('a');
            link.className = 'rating-player-link';
            link.href = `/?player=${encodeURIComponent(r.player_name)}`;
            link.textContent = r.player_name;
            tdPlayer.appendChild(link);
        } else {
            tdPlayer.textContent = '—';
        }

        const givenDelBtn = buildAdminDeleteButton(r.id, () => onDeleted?.());
        if (givenDelBtn) tdPlayer.appendChild(givenDelBtn);

        tr.appendChild(tdPlayer);

        const tdRace = document.createElement('td');
        tdRace.dataset.label = t('ratings.col.race');
        const raceBadge = document.createElement('span');
        raceBadge.className = `race-badge race-${r.race}`;
        raceBadge.textContent = r.race;
        tdRace.appendChild(raceBadge);
        tr.appendChild(tdRace);

        for (const axis of STAT_ORDER) {
            const td = document.createElement('td');
            td.dataset.label = axis.getStr();
            const span = document.createElement('span');
            span.className = 'stat-value';
            span.textContent = String(Number(r[axis.key]));
            span.style.color = axis.color;
            td.appendChild(span);
            tr.appendChild(td);
        }

        tbody.appendChild(tr);
    }
    table.appendChild(tbody);
    card.appendChild(table);
    container.appendChild(card);
}

export async function renderRatingsList(
    playerId: number,
    onDeleted?: () => void
): Promise<void> {
    const container = document.getElementById('ratings-list-container');
    if (!container) return;
    container.innerHTML = '';

    let ratings: Rating[] = [];
    try {
        const res = await apiRequest<RatingsListResponse>(
            `/api/players/${playerId}/ratings`,
            { token: state.token }
        );
        ratings = res.ratings;
    } catch {
        /* не критично */
    }

    // Собираем карточку списка
    const card = document.createElement('div');
    card.className = 'card ratings-list fade-in';

    const header = document.createElement('div');
    header.className = 'ratings-list-header';

    const h3 = document.createElement('h3');

    h3.dataset.i18n = "ratings.title";
    h3.textContent = t("ratings.title");
    header.appendChild(h3);

    if (ratings.length > 0) {
        const deleteAll = buildAdminDeleteAllButton(
            `/api/admin/players/${playerId}/ratings`,
            t('ratings.admin_delete_all_confirm'),
            () => onDeleted?.()
        );
        if (deleteAll) header.appendChild(deleteAll);
    }

    card.appendChild(header);

    if (ratings.length === 0) {
        const p = document.createElement('p');
        p.className = 'hint';
        p.dataset.i18n = state.token ? "ratings.empty" : "ratings.empty_anonymous";
        p.textContent = state.token
            ? t("ratings.empty")
            : t("ratings.empty_anonymous");

        card.appendChild(p);
    } else {
        const table = document.createElement('table');
        const thead = document.createElement('thead');
        const headRow = document.createElement('tr');
        const thUser = document.createElement('th');

        thUser.dataset.i18n = "ratings.col.user";
        thUser.textContent = t("ratings.col.user");
        
        headRow.appendChild(thUser);
        const thRace = document.createElement('th');
        
        thRace.dataset.i18n = "ratings.col.race"
        thRace.textContent = t("ratings.col.race");

        headRow.appendChild(thRace);
        for (const axis of STAT_ORDER) {
            const th = document.createElement('th');
            th.dataset.i18n = axis.langKey;
            th.textContent = axis.getStr();
            headRow.appendChild(th);
        }
        thead.appendChild(headRow);
        table.appendChild(thead);

        const tbody = document.createElement('tbody');
        for (const r of ratings) {
            const tr = document.createElement('tr');

            const tdUser = document.createElement('td');
            const userWrap = document.createElement('span');
            userWrap.className = 'rating-user-cell';
            if (r.rater_player_name) {
                const link = document.createElement('a');
                link.className = 'player-name-link';
                link.href = `/?player=${encodeURIComponent(r.rater_player_name)}`;
                link.textContent = r.username;
                link.title = t('ratings.link_to_player_title');
                link.addEventListener('click', (e) => {
                    e.preventDefault();
                    navigateTo(`/?player=${encodeURIComponent(r.rater_player_name)}`);
                });
                userWrap.appendChild(link);
            } else {
                userWrap.textContent = r.username;
            }

            if (r.is_admin) {
                const badge = document.createElement('span');
                badge.className = 'role-badge role-badge--admin';
                badge.textContent = '★ ADMIN';
                userWrap.appendChild(badge);
            } else if (r.is_ghost) {
                const badge = document.createElement('span');
                badge.className = 'role-badge role-badge--ghost';
                badge.textContent = `💠 ${t('topbar.role_ghost')}`;
                userWrap.appendChild(badge);
            } else if (r.is_moderator) {
                const badge = document.createElement('span');
                badge.className = 'role-badge role-badge--moderator';
                badge.textContent = '◆ MOD';
                userWrap.appendChild(badge);
            }

            // Бейдж «не учитывается» — только для админов (иначе палит shadow-ban).
            if (r.excluded && state.user?.is_admin) {
                const excludedBadge = document.createElement('span');
                excludedBadge.className = 'role-badge role-badge--excluded';
                excludedBadge.textContent = t('ratings.excluded');
                excludedBadge.title = t('ratings.excluded_title');
                userWrap.appendChild(excludedBadge);
            }

            tdUser.appendChild(userWrap);

            const rowDelBtn = buildAdminDeleteButton(r.id, () => onDeleted?.());
            if (rowDelBtn) tdUser.appendChild(rowDelBtn);

            tr.appendChild(tdUser);

            const tdRace = document.createElement('td');
            tdRace.dataset.label = t('ratings.col.race');
            const badge = document.createElement('span');
            badge.className = `race-badge race-${r.race}`;
            badge.textContent = r.race;
            tdRace.appendChild(badge);
            tr.appendChild(tdRace);

            for (const axis of STAT_ORDER) {
                const td = document.createElement('td');
                td.dataset.label = axis.getStr();
                const value = r[axis.key];
                const span = document.createElement('span');
                span.className = 'stat-value';
                span.textContent = ""+Number(value); //LEVEL_LETTERS[value]; // + "" + Number(value) + ""; //.toFixed(2);
                span.style.color = axis.color;
                td.appendChild(span);
                tr.appendChild(td);
            }

            // for (const axis of STAT_ORDER) {
            //     const value = r[axis.key];

            //     const td = document.createElement('td');
            //     td.className = 'col-desktop';
            //     td.appendChild(statBarCell(value, axis.color));
            //     tr.appendChild(td);
            // }


            tbody.appendChild(tr);
        }
        table.appendChild(tbody);
        card.appendChild(table);
    }

    container.appendChild(card);
}