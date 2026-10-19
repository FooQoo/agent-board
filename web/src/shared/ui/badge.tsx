import type * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/shared/lib/classnames/utils';
import { Slot } from 'radix-ui';

const badgeVariants = cva(
  'inline-flex h-[22px] w-fit shrink-0 items-center justify-center gap-1 overflow-hidden rounded-full border px-2.5 text-xs font-medium whitespace-nowrap [&>svg]:pointer-events-none [&>svg]:size-3',
  {
    variants: {
      variant: {
        default: 'border-primary bg-primary text-primary-foreground',
        secondary: 'border-secondary bg-secondary text-foreground',
        outline: 'border-border bg-transparent text-[var(--r-text2)]',
        muted: 'border-border bg-transparent text-muted-foreground',
        pending: 'border-[var(--r-pend-bd)] bg-[var(--r-pend-bg)] text-[var(--r-pend-tx)]',
        destructive: 'border-destructive bg-transparent text-destructive',
      },
    },
    defaultVariants: {
      variant: 'secondary',
    },
  },
);

function Badge({
  className,
  variant = 'secondary',
  asChild = false,
  ...props
}: React.ComponentProps<'span'> & VariantProps<typeof badgeVariants> & { asChild?: boolean }) {
  const Comp = asChild ? Slot.Root : 'span';

  return (
    <Comp
      data-slot="badge"
      data-variant={variant}
      className={cn(badgeVariants({ variant }), className)}
      {...props}
    />
  );
}

export { Badge, badgeVariants };
