import { useSyncExternalStore } from 'react';

const themeKey = 'flowmate:theme';
const sizeKey = 'flowmate:text-size';
type Theme = 'dark' | 'light';
export type TextSize = 'compact' | 'standard' | 'large';

function textSize(value: string | null | undefined): TextSize {
  return value === 'compact' || value === 'large' ? value : 'standard';
}

export function installDocumentAppearance() {
  const { dataset } = document.documentElement;
  const synchronize = (event: StorageEvent) => {
    if (event.key === themeKey || event.key === null) dataset.theme = event.newValue === 'dark' ? 'dark' : 'light';
    if (event.key === sizeKey || event.key === null) dataset.textSize = textSize(event.newValue);
  };
  dataset.theme = localStorage.getItem(themeKey) === 'dark' ? 'dark' : 'light';
  dataset.textSize = textSize(localStorage.getItem(sizeKey));
  window.addEventListener('storage', synchronize);
  return () => window.removeEventListener('storage', synchronize);
}

export function saveDocumentTheme(theme: Theme) {
  localStorage.setItem(themeKey, theme);
  document.documentElement.dataset.theme = theme;
}

export function saveTextSize(size: TextSize) {
  localStorage.setItem(sizeKey, size);
  document.documentElement.dataset.textSize = size;
}

function subscribe(notify: () => void) {
  const observer = new MutationObserver(notify);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'data-text-size'] });
  return () => observer.disconnect();
}

function documentTheme(): Theme {
  const theme = document.documentElement.dataset.theme;
  return theme === 'dark' ? 'dark' : 'light';
}

export function useDocumentTheme() {
  return useSyncExternalStore(subscribe, documentTheme);
}

const documentSize = () => textSize(document.documentElement.dataset.textSize);
export function useTextSize() {
  return useSyncExternalStore(subscribe, documentSize);
}
