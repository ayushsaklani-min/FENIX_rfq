"use client";

import React from "react";
import { cn } from "@/lib/utils";
import { Loader2 } from "lucide-react";

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
    variant?: "primary" | "secondary" | "ghost" | "danger";
    size?: "sm" | "md" | "lg";
    isLoading?: boolean;
    leftIcon?: React.ReactNode;
    rightIcon?: React.ReactNode;
    children?: React.ReactNode;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
    (
        {
            className,
            variant = "primary",
            size = "md",
            isLoading,
            leftIcon,
            rightIcon,
            children,
            disabled,
            ...props
        },
        ref
    ) => {
        const baseStyles =
            "relative inline-flex items-center justify-center rounded-lg font-medium transition-all focus:outline-none focus:ring-2 focus:ring-[hsl(var(--ring)/0.25)] focus:ring-offset-2 focus:ring-offset-white disabled:cursor-not-allowed disabled:opacity-70";

        const variants = {
            primary:
                "border border-[hsl(var(--primary))] bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))] shadow-sm hover:bg-[hsl(var(--primary)/0.92)]",
            secondary:
                "border border-slate-200 bg-white text-slate-900 shadow-sm hover:bg-slate-50",
            ghost: "bg-transparent text-slate-600 hover:bg-slate-100 hover:text-slate-900",
            danger:
                "border border-red-200 bg-red-50 text-red-700 hover:bg-red-100",
        };

        const sizes = {
            sm: "h-8 px-3 text-sm gap-1.5",
            md: "h-10 px-4 text-sm gap-2",
            lg: "h-12 px-6 text-base gap-2",
        };

        return (
            <button
                ref={ref}
                className={cn(baseStyles, variants[variant], sizes[size], className)}
                disabled={isLoading || disabled}
                {...props}
            >
                {isLoading ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                    leftIcon
                )}
                {children}
                {!isLoading && rightIcon}
            </button>
        );
    }
);

Button.displayName = "Button";

export { Button };
