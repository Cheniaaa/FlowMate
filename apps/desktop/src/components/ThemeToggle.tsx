import { Button } from './ui/button';
import { saveDocumentTheme, useDocumentTheme } from './documentAppearance';

export default function ThemeToggle() {
  const theme = useDocumentTheme();
  return <Button variant="ghost" size="sm" aria-label={theme === 'light' ? '切换到深色' : '切换到浅色'}
    onClick={() => saveDocumentTheme(theme === 'light' ? 'dark' : 'light')}>外观 · {theme === 'light' ? '浅色' : '深色'}</Button>;
}
