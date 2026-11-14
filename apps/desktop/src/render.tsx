import { createRoot } from 'react-dom/client';
import App from './App';

export function mountApp(): void {
  createRoot(document.getElementById('root')!).render(<App />);
}
