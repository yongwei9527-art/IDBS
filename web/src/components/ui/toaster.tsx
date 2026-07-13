import { Toaster as SonnerToaster } from 'sonner';

export function Toaster() {
  return (
    <SonnerToaster
      position="top-right"
      toastOptions={{
        duration: 4000,
        className: 'text-sm font-sans'
      }}
      visibleToasts={5}
      closeButton
      richColors
    />
  );
}