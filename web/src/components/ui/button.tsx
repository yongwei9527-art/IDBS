import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

const buttonVariants = cva(
  'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-[10px] text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-60 disabled:shadow-none [&_svg]:size-4 [&_svg]:shrink-0',
  {
    variants: {
      variant: {
        default: 'border border-cyan-200/25 bg-primary text-primary-foreground shadow-[0_8px_20px_rgba(30,169,210,0.16)] hover:bg-cyan-300 hover:shadow-[0_10px_24px_rgba(30,169,210,0.22)]',
        destructive: 'bg-destructive text-destructive-foreground hover:brightness-95',
        outline: 'border border-cyan-300/22 bg-card/70 text-foreground hover:border-cyan-200/35 hover:bg-cyan-300/[0.08] hover:text-slate-100',
        secondary: 'bg-secondary text-secondary-foreground hover:bg-cyan-300/[0.08] hover:text-slate-100',
        ghost: 'hover:bg-cyan-300/[0.08] hover:text-cyan-100',
        link: 'text-primary underline-offset-4 hover:underline'
      },
      size: {
        default: 'h-10 px-4 py-2',
        sm: 'h-9 px-3',
        lg: 'h-11 rounded-xl px-6',
        icon: 'h-10 w-10 rounded-[10px]'
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
