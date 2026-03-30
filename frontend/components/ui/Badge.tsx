import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const badgeVariants = cva(
    "inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium transition-colors",
    {
        variants: {
            variant: {
                default:
                    "border border-indigo-200 bg-indigo-50 text-indigo-700",
                secondary:
                    "border border-slate-200 bg-slate-100 text-slate-700",
                destructive:
                    "border border-red-200 bg-red-50 text-red-700",
                outline:
                    "border border-slate-200 bg-white text-slate-600",
                success:
                    "border border-emerald-200 bg-emerald-50 text-emerald-700",
                warning:
                    "border border-amber-200 bg-amber-50 text-amber-700",
            },
        },
        defaultVariants: {
            variant: "default",
        },
    }
);

export interface BadgeProps
    extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof badgeVariants> { }

function Badge({ className, variant, ...props }: BadgeProps) {
    return (
        <div className={cn(badgeVariants({ variant }), className)} {...props} />
    );
}

export { Badge, badgeVariants };
