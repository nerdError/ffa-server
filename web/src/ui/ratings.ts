import { apiRequest } from '../api';
import { STAT_ORDER } from '../radar';
import { state } from '../state';
import {
  RACES,
  STAT_KEYS,
  type MyRating,
  type MyRatingResponse,
  type Race,
  type Rating,
  type RatingsListResponse,
  type RatingInput,
} from '../types';

function statPill(value: number | null): HTMLSpanElement {
  const span = document.createElement('span');
  if (value === null || value === undefined) {
    span.className = 'stat-pill stat-empty';
    span.textContent = '—';
    return span;
  }
  const rounded = Math.round(Number(value));
  span.className = `stat-pill stat-${Math.min(5, Math.max(1, rounded))}`;
  span.textContent = Number(value).toFixed(2);
  return span;
}

/**
 * Строит форму оценки со слайдерами.
 * onChange вызывается на каждое движение — чтобы live-превью работало.
 */
export async function renderRatingForm(
  playerId: number,
  onChange: (draft: RatingInput) => void,
  onSaved: () => void
): Promise<void> {
  const container = document.getElementById('rating-form-container');
  if (!container) return;

  let mine: MyRating | null = null;
  try {
    const res = await apiRequest<MyRatingResponse>(
      `/api/players/${playerId}/my-rating`,
      { token: state.token }
    );
    mine = res.rating;
  } catch {
    /* не критично */
  }

  const card = document.createElement('div');
  card.className = 'card rating-card';

  const title = document.createElement('h3');
  title.textContent = mine ? 'Изменить свою оценку' : 'Оценить игрока';
  card.appendChild(title);

  const form = document.createElement('form');
  form.className = 'rating-form';

  // --- Раса: сегментные кнопки ---
  const raceRow = document.createElement('div');
  raceRow.className = 'rating-race-row';

  let currentRace: Race = mine?.race ?? 'T';

  for (const r of RACES) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = `race-toggle race-toggle-${r}`;
    btn.textContent = r;
    btn.dataset.race = r;
    if (r === currentRace) btn.classList.add('active');
    btn.addEventListener('click', () => {
      currentRace = r;
      raceRow.querySelectorAll('.race-toggle').forEach((el) => {
        el.classList.toggle('active', (el as HTMLElement).dataset.race === r);
      });
      emitChange();
    });
    raceRow.appendChild(btn);
  }
  form.appendChild(raceRow);

  // --- Слайдеры для параметров ---
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
    input.value = String(mine?.[axis.key] ?? 3);
    input.className = 'slider';

    const updateOutput = () => {
      const v = Number(input.value);
      const letter = ({ 1: 'E', 2: 'D', 3: 'C', 4: 'B', 5: 'A' } as Record<number, string>)[v] ?? '?';
      value.textContent = `${v} · ${letter}`;
    };
    updateOutput();

    input.addEventListener('input', () => {
      updateOutput();
      emitChange();
    });

    sliders[axis.key] = input;
    row.append(labelWrap, input);
    form.appendChild(row);
  }

  // --- Кнопки ---
  const actions = document.createElement('div');
  actions.className = 'actions';

  const saveBtn = document.createElement('button');
  saveBtn.type = 'submit';
  saveBtn.className = 'btn-primary';
  saveBtn.textContent = mine ? 'Обновить' : 'Сохранить';
  actions.appendChild(saveBtn);

  if (mine) {
    const delBtn = document.createElement('button');
    delBtn.type = 'button';
    delBtn.className = 'btn-danger';
    delBtn.textContent = 'Удалить мою оценку';
    delBtn.addEventListener('click', () => {
      void (async () => {
        if (!confirm('Удалить вашу оценку?')) return;
        try {
          await apiRequest(`/api/players/${playerId}/my-rating`, {
            method: 'DELETE',
            token: state.token,
          });
          onSaved();
        } catch (err) {
          alert('Не удалось удалить: ' +
            (err instanceof Error ? err.message : String(err)));
        }
      })();
    });
    actions.appendChild(delBtn);
  }

  form.appendChild(actions);

  // --- Собираем draft и отдаём наверх ---
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

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    void (async () => {
      try {
        await apiRequest(`/api/players/${playerId}/ratings`, {
          method: 'POST',
          token: state.token,
          body: collectDraft(),
        });
        onSaved();
      } catch (err) {
        alert('Не удалось сохранить оценку: ' +
          (err instanceof Error ? err.message : String(err)));
      }
    })();
  });

  container.innerHTML = '';
  container.appendChild(card);

  // Первичный emit — чтобы карточка сразу показала draft
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

  const card = document.createElement('div');
  card.className = 'card ratings-list';

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
    for (const label of ['Пользователь', 'Раса', ...STAT_KEYS]) {
      const th = document.createElement('th');
      th.textContent = label;
      headRow.appendChild(th);
    }
    thead.appendChild(headRow);
    table.appendChild(thead);

    const tbody = document.createElement('tbody');
    for (const r of ratings) {
      const tr = document.createElement('tr');

      const tdUser = document.createElement('td');
      tdUser.textContent = r.email || r.user_id;
      tr.appendChild(tdUser);

      const tdRace = document.createElement('td');
      const badge = document.createElement('span');
      badge.className = `race-badge race-${r.race}`;
      badge.textContent = r.race;
      tdRace.appendChild(badge);
      tr.appendChild(tdRace);

      for (const key of STAT_KEYS) {
        const td = document.createElement('td');
        td.appendChild(statPill(r[key]));
        tr.appendChild(td);
      }

      tbody.appendChild(tr);
    }
    table.appendChild(tbody);
    card.appendChild(table);
  }

  container.appendChild(card);
}