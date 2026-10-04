/**
 * Управление прелоадером и плавными переходами.
 */

export function markPageReady(): void {
  requestAnimationFrame(() => {
    document.body.classList.add('is-ready');
  });
}

export function setupPreloaderFallback(): void {
  setTimeout(() => {
    if (!document.body.classList.contains('is-ready')) {
      console.warn('[nav] preloader fallback triggered');
      document.body.classList.add('is-ready');
    }
  }, 3000);
}