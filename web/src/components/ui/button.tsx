import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

const buttonVariants = cva(
  'ui-button relative inline-flex items-center justify-center gap-2 overflow-hidden whitespace-nowrap rounded-md text-sm font-semibold transition-[color,background-color,border-color] duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 disabled:pointer-events-none disabled:opacity-100 disabled:shadow-none disabled:transform-none [&_svg]:size-4 [&_svg]:shrink-0',
  {
    variants: {
      variant: {
        default: 'ui-button--primary border border-primary bg-primary text-primary-foreground',
        destructive: 'ui-button--destructive border border-destructive bg-destructive text-destructive-foreground',
        outline: 'ui-button--outline border border-border bg-card text-foreground',
        secondary: 'ui-button--secondary border border-transparent bg-secondary text-secondary-foreground',
        ghost: 'ui-button--ghost border border-transparent text-foreground',
        link: 'ui-button--link text-primary underline-offset-4 hover:underline'
      },
      size: {
        default: 'h-9 px-4 py-2',
        sm: 'h-8 px-3 text-xs',
        lg: 'h-11 rounded-md px-6',
        icon: 'h-9 w-9 rounded-md'
      }
    },
    defaultVariants: {
      variant: 'default',
      size: 'default'
    }
  }
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, ...props }, ref) => (
    <button ref={ref} className={cn(buttonVariants({ variant, size }), className)} {...props} />
  )
);
Button.displayName = 'Button';

export { Button, buttonVariants };
