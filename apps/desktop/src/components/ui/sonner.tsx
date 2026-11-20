import { Toaster as Sonner } from 'sonner';

export function Toaster() {
  return <Sonner position="top-right" richColors closeButton containerAriaLabel="通知" toastOptions={{ duration: 6000, closeButtonAriaLabel: '关闭通知' }} />;
}
