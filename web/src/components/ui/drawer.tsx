import type { ReactNode } from 'react';
import { XIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Drawer as DrawerPrimitive } from '@base-ui/react/drawer';

export function Drawer({
  open,
  onOpenChange,
  identity,
  title,
  label,
  children,
}: {
  open: boolean;
  onOpenChange(open: boolean): void;
  identity: string;
  title: string;
  label?: ReactNode;
  children: ReactNode;
}) {
  const { t } = useTranslation();

  return (
    <DrawerPrimitive.Root open={open} onOpenChange={onOpenChange} swipeDirection="down">
      <DrawerPrimitive.Portal>
        <DrawerPrimitive.Backdrop className="mobile-drawer__overlay" data-slot="drawer-backdrop" />
        <DrawerPrimitive.Viewport className="mobile-drawer__viewport" data-slot="drawer-viewport">
          <DrawerPrimitive.Popup className="mobile-drawer" data-slot="drawer-popup">
            <DrawerPrimitive.Content className="mobile-drawer__content" data-slot="drawer-content">
              <button
                type="button"
                className="mobile-drawer__handle"
                aria-label={t('monitor.drawer.dismiss')}
                onKeyDown={(event) => {
                  if (event.key === 'ArrowDown') {
                    event.preventDefault();
                    onOpenChange(false);
                  }
                }}
              >
                <span className="mobile-drawer__handle-indicator" aria-hidden="true" />
              </button>
              <header className="mobile-drawer__header">
                <div className="mobile-drawer__heading">
                  <p className="mobile-drawer__identity">{identity}</p>
                  <DrawerPrimitive.Title className="mobile-drawer__title">
                    {title}
                  </DrawerPrimitive.Title>
                  {label}
                </div>
                <DrawerPrimitive.Close
                  className="mobile-drawer__close"
                  aria-label={t('detail.close')}
                >
                  <XIcon className="mobile-drawer__close-icon" aria-hidden="true" />
                </DrawerPrimitive.Close>
              </header>
              {children}
            </DrawerPrimitive.Content>
          </DrawerPrimitive.Popup>
        </DrawerPrimitive.Viewport>
      </DrawerPrimitive.Portal>
    </DrawerPrimitive.Root>
  );
}
