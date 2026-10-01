import { apiRequest, ApiRequestError } from '../api';
import { STAT_ORDER } from '../radar';
import { state } from '../state';
import {
    RACES,
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
    editBtn.textContent = mine ? '✎ Изменить мою оценку' : '+ Добавить оценку';

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
        delBtn.textContent = '🗑 Удалить мою оценку';

        delBtn.addEventListener('click', () => {
            void (async () => {
                if (!confirm('Удалить вашу оценку? Это действие нельзя отменить.')) {
                    return;
                }
                try {
                    delBtn.disabled = true;
                    delBtn.textContent = 'Удаление…';

                    await apiRequest(`/api/players/${playerId}/my-rating`, {
                        method: 'DELETE',
                        token: state.token,
                    });

                    onDeleted();
                } catch (err) {
                    delBtn.disabled = false;
                    delBtn.textContent = '🗑 Удалить мою оценку';
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
        label.textContent = axis.ru;
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

export async function renderRatingsList(playerId: number): Promise<void> {
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

    const h3 = document.createElement('h3');
    h3.textContent = 'Оценки пользователей';
    card.appendChild(h3);

    if (ratings.length === 0) {
        const p = document.createElement('p');
        p.className = 'hint';
        p.textContent = state.token
            ? 'Пока никто не оценил этого игрока.'
            : 'Войдите, чтобы увидеть, кто и как оценил игрока.';
        card.appendChild(p);
    } else {
        const table = document.createElement('table');
        const thead = document.createElement('thead');
        const headRow = document.createElement('tr');
        const thUser = document.createElement('th');
        thUser.textContent = 'Пользователь';
        headRow.appendChild(thUser);
        const thRace = document.createElement('th');
        thRace.textContent = 'Раса';
        headRow.appendChild(thRace);
        for (const axis of STAT_ORDER) {
            const th = document.createElement('th');
            th.textContent = axis.ru;
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
            userWrap.textContent = r.username;

            if (r.is_admin) {
                const badge = document.createElement('span');
                badge.className = 'role-badge role-badge--admin';
                badge.textContent = '★ ADMIN';
                userWrap.appendChild(badge);
            } else if (r.is_moderator) {
                const badge = document.createElement('span');
                badge.className = 'role-badge role-badge--moderator';
                badge.textContent = '◆ MOD';
                userWrap.appendChild(badge);
            }

            tdUser.appendChild(userWrap);
            tr.appendChild(tdUser);

            const tdRace = document.createElement('td');
            const badge = document.createElement('span');
            badge.className = `race-badge race-${r.race}`;
            badge.textContent = r.race;
            tdRace.appendChild(badge);
            tr.appendChild(tdRace);

            for (const axis of STAT_ORDER) {
                const td = document.createElement('td');
                const value = r[axis.key];
                const span = document.createElement('span');
                span.className = 'stat-value';
                //Number(value) + " "
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