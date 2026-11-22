import { Toaster as Sonner } from 'sonner';
import { useDocumentTheme } from '../documentAppearance';

export function Toaster() {
  const theme = useDocumentTheme();
  return <Sonner theme={theme} position="top-right" richColors closeButton containerAriaLabel="通知"
    className="flowmate-toaster"
    toastOptions={{ duration: 6000, closeButtonAriaLabel: '关闭通知' }} />;
}
