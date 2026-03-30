import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
    return twMerge(clsx(inputs));
}

export function truncateMiddle(value: string, start = 10, end = 8) {
    if (!value || value.length <= start + end + 3) return value;
    return `${value.slice(0, start)}...${value.slice(-end)}`;
}
