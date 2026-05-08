import * as React from "react"
import type { VariantProps } from "class-variance-authority"
import { cva } from "class-variance-authority"
import { cn } from "@/lib/utils"

const badgeVariants = cva(
  "inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2",
  {
    variants: {
      variant: {
        default:
          "border-transparent bg-primary/80 text-white",
        secondary:
          "border-white/[0.08] bg-white/[0.08] text-white/70 backdrop-blur-xl",
        destructive:
          "border-transparent bg-destructive/80 text-white",
        outline: "border-white/[0.15] text-white/70",
        success: "border-transparent bg-success/20 text-success",
        warning: "border-transparent bg-warning/20 text-warning",
        error: "border-transparent bg-destructive/20 text-destructive",
        info: "border-transparent bg-primary/20 text-primary",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
)

export interface BadgeProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return (
    <div className={cn(badgeVariants({ variant }), className)} {...props} />
  )
}

export { Badge, badgeVariants }
