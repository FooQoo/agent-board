import type * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/shared/lib/classnames/utils';
import { Slot } from 'radix-ui';

/** The fixed button sizes, smallest to largest. */
export const BUTTON_SIZES = ['s', 'm', 'l', 'xl', '2xl'] as const;
export type ButtonSize = (typeof BUTTON_SIZES)[number];

const buttonVariants = cva(
  "inline-flex shrink-0 items-center justify-center gap-2 rounded-lg text-[13px] font-medium whitespace-nowrap transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default: 'bg-primary text-primary-foreground hover:bg-primary/90',
        outline: 'border border-border bg-transparent text-foreground hover:bg-accent',
        destructive: 'bg-destructive text-primary-foreground hover:bg-destructive/90',
        ghost: 'text-foreground hover:bg-accent',
      },
      // The five sizes are defined once, as --btn-* tokens in shared/styles/ui.css.
      size: {
        s: 'h-(--btn-s-h) px-(--btn-s-px) [font-size:var(--btn-s-fs)]',
        m: 'h-(--btn-m-h) px-(--btn-m-px) [font-size:var(--btn-m-fs)]',
        l: 'h-(--btn-l-h) px-(--btn-l-px) [font-size:var(--btn-l-fs)]',
        xl: 'h-(--btn-xl-h) px-(--btn-xl-px) [font-size:var(--btn-xl-fs)]',
        '2xl': 'h-(--btn-2xl-h) px-(--btn-2xl-px) [font-size:var(--btn-2xl-fs)]',
      },
      iconOnly: {
        true: 'px-0',
        false: '',
      },
    },
    compoundVariants: [
      { size: 's', iconOnly: true, className: 'w-(--btn-s-icon)' },
      { size: 'm', iconOnly: true, className: 'w-(--btn-m-icon)' },
      { size: 'l', iconOnly: true, className: 'w-(--btn-l-icon)' },
      { size: 'xl', iconOnly: true, className: 'w-(--btn-xl-icon)' },
      { size: '2xl', iconOnly: true, className: 'w-(--btn-2xl-icon)' },
    ],
    defaultVariants: {
      variant: 'default',
      size: 'm',
      iconOnly: false,
    },
  },
);

function Button({
  className,
  variant = 'default',
  size = 'm',
  iconOnly = false,
  asChild = false,
  ...props
}: React.ComponentProps<'button'> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean;
  }) {
  const Comp = asChild ? Slot.Root : 'button';

  return (
    <Comp
      data-slot="button"
      data-variant={variant}
      data-size={size}
      data-icon-only={iconOnly ? '' : undefined}
      className={cn(buttonVariants({ variant, size, iconOnly, className }))}
      {...props}
    />
  );
}

export { Button, buttonVariants };
