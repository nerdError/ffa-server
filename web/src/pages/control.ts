import { apiRequest } from '../api';
import { state } from '../state';
import { t, onLocaleChange } from '../i18n';
import type { PlayerWithStats, PlayersListResponse } from '../types';
import { navigateTo } from '../router';

interface OverlaySettings {
  animation: 'fade' | 'slide-left' | 'slide-right' | 'slide-up' | 'slide-down' | 'none';
  autoHide: boolean;
  autoHideDelay: number;
  viewMode: 'average' | 'personal' | 'ghost';
}

interface OverlayState {
  currentPlayerId: number | null;
  settings: OverlaySettings;
  version: number;
}

let abortController: AbortController | null = null;
let cachedPlayers: PlayerWithStats[] = [];
let currentState: OverlayState | null = null;
let currentToken: string | null = null;

export function mountControl(_params: URLSearchParams): void {
  // Проверка авторизации
  if (!state.token || !state.user) {
    sessionStorage.setItem('redirectAfterLogin', '/control');
    navigateTo('/', true);
    return;
  }

  const screen = document.getElementById('screen-control');
  if (screen) screen.classList.remove('hidden');

  abortController = new AbortController();
  const { signal } = abortController;

  const playersBox = document.getElementById('control-players');
  const searchInput = document.getElementById('control-search') as HTMLInputElement | null;
  const statusBox = document.getElementById('control-status');
  const currentBox = document.getElementById('control-current');
  const hideBtn = document.getElementById('btn-hide');
  const animationSelect = document.getElementById('setting-animation') as HTMLSelectElement | null;
  const autoHideCheckbox = document.getElementById('setting-autohide') as HTMLInputElement | null;
  const delayInput = document.getElementById('setting-delay') as HTMLInputElement | null;
  const viewModeSelect = document.getElementById('setting-view-mode') as HTMLSelectElement | null;

  // Кнопка игрока (общая для обеих групп)
  function buildPlayerBtn(p: PlayerWithStats): HTMLButtonElement {
    const color = getRaceColor(p.races);
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'control-player-btn';
    btn.textContent = p.name;
    btn.style.setProperty('--race-color', color);
    if (currentState?.currentPlayerId === p.id) btn.classList.add('is-active');
    btn.addEventListener('click', () => void showPlayer(p.id), { signal });
    return btn;
  }

  // Строит подраздел: заголовок + кнопки игроков
  function appendGroup(box: HTMLElement, title: string, players: PlayerWithStats[]): void {
    if (players.length === 0) return;
    const header = document.createElement('div');
    header.className = 'control-group-title';
    header.textContent = title;
    box.appendChild(header);
    for (const p of players) box.appendChild(buildPlayerBtn(p));
  }

  function renderPlayers(filter: string): void {
    if (!playersBox) return;
    playersBox.innerHTML = '';

    const q = filter.toLowerCase();
    const filtered = cachedPlayers.filter((p) =>
      p.name.toLowerCase().includes(q) || (p.aka ?? '').toLowerCase().includes(q)
    );

    if (filtered.length === 0) {
      const msg = cachedPlayers.length === 0
        ? t('control.no_players')
        : t('players.nothing_found');
      playersBox.innerHTML = `<p class="hint">${msg}</p>`;
      return;
    }

    // Первый подраздел — игроки с оценками; второй — без оценок, но с играми
    const rated = filtered.filter((p) => p.vote_count > 0);
    const unratedWithGames = filtered.filter((p) => p.vote_count === 0 && p.games_played > 0);

    appendGroup(playersBox, t('control.rated_players'), rated);
    appendGroup(playersBox, t('control.unrated_players'), unratedWithGames);
  }

  function renderState(s: OverlayState): void {
    currentState = s;

    if (currentBox) {
      if (s.currentPlayerId === null) {
        currentBox.textContent = t('control.current_nothing');
        currentBox.classList.remove('is-active');
      } else {
        const player = cachedPlayers.find((p) => p.id === s.currentPlayerId);
        currentBox.textContent = player
          ? `${t('control.current_prefix')}${player.name}`
          : `${t('control.current_prefix')}#${s.currentPlayerId}`;
        currentBox.classList.add('is-active');
      }
    }

    if (animationSelect) animationSelect.value = s.settings.animation;
    if (autoHideCheckbox) autoHideCheckbox.checked = s.settings.autoHide;
    if (delayInput) delayInput.value = String(s.settings.autoHideDelay);
    if (viewModeSelect) viewModeSelect.value = s.settings.viewMode ?? 'average';

    renderPlayers(searchInput?.value ?? '');
  }

  async function fetchState(): Promise<void> {
    try {
      const s = await apiRequest<OverlayState>('/api/control/state', { token: state.token });
      renderState(s);
      if (statusBox) {
        statusBox.textContent = `● ${t('control.connected')}`;
        statusBox.classList.remove('is-error');
        statusBox.classList.add('is-ok');
      }
    } catch {
      if (statusBox) {
        statusBox.textContent = `● ${t('control.disconnected')}`;
        statusBox.classList.add('is-error');
        statusBox.classList.remove('is-ok');
      }
    }
  }

  async function showPlayer(playerId: number): Promise<void> {
    try {
      const res = await apiRequest<{ state: OverlayState }>('/api/control/show', {
        method: 'POST', token: state.token, body: { playerId },
      });
      renderState(res.state);
    } catch (err) {
      alert(t('control.show_error') + (err instanceof Error ? err.message : String(err)));
    }
  }

  async function hidePlayer(): Promise<void> {
    try {
      const res = await apiRequest<{ state: OverlayState }>('/api/control/hide', {
        method: 'POST', token: state.token,
      });
      renderState(res.state);
    } catch (err) {
      alert(t('control.hide_error') + (err instanceof Error ? err.message : String(err)));
    }
  }

  async function updateSettings(patch: Partial<OverlaySettings>): Promise<void> {
    try {
      const res = await apiRequest<{ state: OverlayState }>('/api/control/settings', {
        method: 'POST', token: state.token, body: patch,
      });
      renderState(res.state);
    } catch (err) {
      alert(t('control.settings_error') + (err instanceof Error ? err.message : String(err)));
    }
  }

  async function setupOverlayPanel(): Promise<void> {
    const urlInput = document.getElementById('overlay-url') as HTMLInputElement | null;
    const copyBtn = document.getElementById('btn-copy-url') as HTMLButtonElement | null;
    const openBtn = document.getElementById('btn-open-overlay') as HTMLAnchorElement | null;
    const regenBtn = document.getElementById('btn-regenerate-token') as HTMLButtonElement | null;

    if (!urlInput || !copyBtn || !regenBtn) return;

    let currentUrl = '';

    const updateUrl = (token: string): void => {
      currentUrl = `${window.location.origin}/overlay?token=${token}`;
      urlInput.value = currentUrl;
      if (openBtn) openBtn.href = currentUrl;
    };

    try {
      const res = await apiRequest<{ token: string }>('/api/control/token', {
        token: state.token,
      });
      currentToken = res.token;
      updateUrl(res.token);
      connectSSE(res.token);
    } catch (err) {
      console.error('[control] failed to fetch overlay token:', err);
      urlInput.value = t('control.token_error');
    }

    urlInput.addEventListener('focus', () => urlInput.select(), { signal });

    copyBtn.addEventListener('click', async () => {
      if (!currentUrl) return;
      try {
        await navigator.clipboard.writeText(currentUrl);
        copyBtn.classList.add('is-copied');
        const label = copyBtn.querySelector('.control-copy-label');
        const icon = copyBtn.querySelector('.control-copy-icon');
        const origLabel = label?.textContent ?? '';
        const origIcon = icon?.textContent ?? '';
        if (label) label.textContent = t('common.copied');
        if (icon) icon.textContent = '✓';
        setTimeout(() => {
          copyBtn.classList.remove('is-copied');
          if (label) label.textContent = origLabel;
          if (icon) icon.textContent = origIcon;
        }, 1800);
      } catch {
        urlInput.focus();
        urlInput.select();
        alert(t('control.copy_error'));
      }
    }, { signal });

    regenBtn.addEventListener('click', async () => {
      if (!confirm(t('control.regenerate_confirm'))) return;
      try {
        regenBtn.disabled = true;
        const res = await apiRequest<{ token: string }>('/api/control/token/regenerate', {
          method: 'POST', token: state.token,
        });
        currentToken = res.token;
        updateUrl(res.token);
      } catch (err) {
        alert(t('control.regenerate_error') + (err instanceof Error ? err.message : String(err)));
      } finally {
        regenBtn.disabled = false;
      }
    }, { signal });
  }

  function connectSSE(token: string): void {
    const url = `/api/overlay/stream?token=${encodeURIComponent(token)}`;
    const es = new EventSource(url);

    es.addEventListener('message', (e) => {
      try {
        const s = JSON.parse(e.data) as OverlayState;
        renderState(s);
      } catch (err) {
        console.error('[control] parse SSE error:', err);
      }
    });

    es.addEventListener('error', () => {
      console.warn('[control] SSE error, reconnecting…');
    });

    signal.addEventListener('abort', () => es.close());
  }

  // Инициализация
  void (async () => {
    try {
      const res = await apiRequest<PlayersListResponse>('/api/players');
      // Показываем игроков с оценками и без оценок, но с хотя бы одной игрой
      cachedPlayers = res.players.filter((p) => p.vote_count > 0 || p.games_played > 0);
      renderPlayers('');
    } catch {
      if (playersBox) playersBox.innerHTML = `<p class="hint">${t('control.no_players')}</p>`;
    }

    await fetchState();
    await setupOverlayPanel();
  })();

  // Обработчики UI
  hideBtn?.addEventListener('click', () => void hidePlayer(), { signal });
  searchInput?.addEventListener('input', () => renderPlayers(searchInput.value), { signal });
  animationSelect?.addEventListener('change', () => {
    void updateSettings({ animation: animationSelect.value as any });
  }, { signal });
  autoHideCheckbox?.addEventListener('change', () => {
    void updateSettings({ autoHide: autoHideCheckbox.checked });
  }, { signal });
  delayInput?.addEventListener('change', () => {
    const d = Number(delayInput.value);
    if (Number.isInteger(d) && d >= 1 && d <= 600) void updateSettings({ autoHideDelay: d });
  }, { signal });
  viewModeSelect?.addEventListener('change', () => {
    void updateSettings({ viewMode: viewModeSelect.value as any });
  }, { signal });

  // Обновление при смене языка
  onLocaleChange(() => {
    if (statusBox && statusBox.classList.contains('is-ok')) {
      statusBox.textContent = `● ${t('control.connected')}`;
    }
    if (currentState) renderState(currentState);
  });
}

export function unmountControl(): void {
  abortController?.abort();
  abortController = null;
  currentToken = null;
}

function getRaceColor(races: string[]): string {
  if (races.length === 0) return 'var(--race-mixed)';
  if (races.length === 1) {
    const r = races[0];
    if (r === 'T') return 'var(--race-terran)';
    if (r === 'Z') return 'var(--race-zerg)';
    if (r === 'P') return 'var(--race-protoss)';
    if (r === 'R') return 'var(--race-random)';
  }
  return 'var(--race-mixed)';
}