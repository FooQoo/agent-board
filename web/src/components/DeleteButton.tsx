import { forwardRef } from 'react';
import { Trash } from './icons';

export const DeleteButton = forwardRef<HTMLButtonElement, { onClick: () => void }>(function DeleteButton(
  { onClick },
  ref,
) {
  return (
    <button ref={ref} type="button" className="delete-button" aria-label="Delete card" onClick={onClick}>
      <Trash />
    </button>
  );
});
