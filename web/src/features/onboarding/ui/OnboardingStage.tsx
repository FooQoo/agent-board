import type { ReactNode } from 'react';
import { Dialog, DialogContent } from '@/shared/ui/dialog';
import { Spotlight, type SpotlightRect } from '@/shared/ui/spotlight/Spotlight';
import { STAGE_DIALOG_CLASS } from './dialog-classes';

/**
 * The guide's modal stage. It is a shared Dialog with a transparent overlay: the dimming comes from
 * the spotlight, so the stage can frame a region and still leave the region's content interactive.
 * Radix keeps focus inside the stage and makes the board behind it inert.
 */
export function OnboardingStage({
  target,
  renderTarget,
  guide,
  onExit,
}: {
  /** The region to frame, in stage pixels; null leaves the whole stage without a frame. */
  target: SpotlightRect | null;
  /** The live cards or answer form, rendered inside the frame by the app. */
  renderTarget?: ReactNode;
  guide: ReactNode;
  onExit: () => void;
}) {
  return (
    <Dialog open>
      <DialogContent
        showCloseButton={false}
        overlayClassName="bg-transparent"
        className={STAGE_DIALOG_CLASS}
        aria-label="Guide"
        onEscapeKeyDown={(event) => {
          event.preventDefault();
          onExit();
        }}
        onPointerDownOutside={(event) => event.preventDefault()}
        onInteractOutside={(event) => event.preventDefault()}
      >
        {target ? <Spotlight target={target}>{renderTarget}</Spotlight> : null}
        {guide}
      </DialogContent>
    </Dialog>
  );
}
