'use client';
import type { ComponentProps, ReactElement, ReactNode } from 'react';
import type { VariantProps } from 'class-variance-authority';
import { Button as SdkButton } from '@ui-sdk/react/button';
import { Popover, PopoverContent, PopoverTitle, PopoverTrigger } from '@ui-sdk/react/popover';
import { SegmentedControl, SegmentedControlIndicator, SegmentedControlItem } from '@ui-sdk/react/segmented-control';
import { Toggle as SdkToggle } from '@ui-sdk/react/toggle';
import { Toolbar as SdkToolbar, ToolbarButton as SdkToolbarButton } from '@ui-sdk/react/toolbar';
import { Tooltip, TooltipContent, TooltipShortcut, TooltipTrigger } from '@ui-sdk/react/tooltip';
import { buttonVariants } from '@/components/ui/button';
import { cn } from '@/lib/utils';

/**
 * The canvas's controls: UI SDK parts styled like the app's shadcn buttons. Every UI SDK component the board
 * renders comes through here, so a beta API change touches one file.
 */

type Look = VariantProps<typeof buttonVariants> & { className?: string };
const look = ({ variant = 'default', size = 'default', className }: Look) => cn(buttonVariants({ variant, size }), className);
/** How a pressed toggle or checked segment looks: the secondary button. */
const PRESSED = 'data-pressed:border-(--w-bronze)/40 data-pressed:bg-(--w-parchment) data-pressed:text-(--w-parchment-ink)';

export function BoardButton({ variant, size, className, ...props }: Omit<ComponentProps<typeof SdkButton>, 'className'> & Look) {
    return <SdkButton data-variant={variant ?? 'default'} className={look({ variant, size, className })} {...props}/>;
}

/** A row of controls with one tab stop; arrows move between them. */
export function BoardToolbar({ className, ...props }: Omit<ComponentProps<typeof SdkToolbar>, 'className'> & { className?: string }) {
    return <SdkToolbar className={cn('flex items-center gap-0.5', className)} {...props}/>;
}

export function BoardToolbarButton({ variant = 'ghost', size, className, ...props }: Omit<ComponentProps<typeof SdkToolbarButton>, 'className'> & Look) {
    return <SdkToolbarButton className={look({ variant, size, className })} {...props}/>;
}

/** A button that stays pressed; inside a toolbar it joins its arrow-key navigation. */
export function BoardToggle({ size, className, ...props }: Omit<ComponentProps<typeof SdkToggle>, 'className'> & Omit<Look, 'variant'>) {
    return <SdkToggle className={look({ variant: 'ghost', size, className: cn(PRESSED, className) })} {...props}/>;
}

/** One choice among a few, like the canvas tool. */
export function BoardSegmented<T extends string>({ items, className, ...props }: Omit<ComponentProps<typeof SegmentedControl<T>>, 'className' | 'children'> & {
    className?: string;
    items: { value: T; label: ReactNode; hint?: ReactNode; shortcut?: string }[];
}) {
    return <SegmentedControl<T> className={cn('relative isolate inline-flex gap-0.5 rounded-md border p-0.5', className)} {...props}>
      <SegmentedControlIndicator className="absolute top-(--segmented-control-indicator-top) left-(--segmented-control-indicator-left) -z-10 h-(--segmented-control-indicator-height) w-(--segmented-control-indicator-width) rounded-xs border border-(--w-bronze)/40 bg-(--w-parchment) transition-[left,width] duration-200 motion-reduce:transition-none"/>
      {items.map(item => {
          const segment = <SegmentedControlItem key={item.value} value={item.value} className={cn(buttonVariants({ variant: 'ghost', size: 'sm' }), 'hover:bg-transparent data-checked:text-(--w-parchment-ink)')}>{item.label}</SegmentedControlItem>;
          return item.hint ? <Hint key={item.value} label={item.hint} shortcut={item.shortcut} side="bottom">{segment}</Hint> : segment;
      })}
    </SegmentedControl>;
}

/** A short hint on hover and keyboard focus, with the keys that do the same thing. Replaces `title`. */
export function Hint({ label, shortcut, side = 'top', children }: { label: ReactNode; shortcut?: string; side?: 'top' | 'bottom' | 'left' | 'right'; children: ReactElement<Record<string, unknown>> }) {
    return <Tooltip delay={500} shortcut={shortcut}>
      <TooltipTrigger render={children}/>
      <TooltipContent side={side} sideOffset={6} className="z-50 flex max-w-80 items-center gap-2 rounded-md bg-foreground px-2 py-1 text-xs whitespace-pre-line text-background shadow-md origin-(--transform-origin) transition-[opacity,scale] duration-100 data-starting-style:scale-95 data-starting-style:opacity-0 data-ending-style:opacity-0 data-instant:transition-none">
        {label}
        {shortcut && <TooltipShortcut className="rounded border border-background/30 px-1 font-mono text-[10px] opacity-80"/>}
      </TooltipContent>
    </Tooltip>;
}

/**
 * A small confirmation anchored to its trigger. It opens in the top layer, so the canvas's transform never
 * scales or clips it. `onOpenChange` can cancel an open, like when there is nothing to confirm. `hint` is the
 * trigger's tooltip, which stays available after the confirmation is no longer asked for.
 */
export function Confirm({ open, onOpenChange, trigger, hint, title, children }: {
    open: boolean;
    hint?: ReactNode;
    onOpenChange: ComponentProps<typeof Popover>['onOpenChange'];
    trigger: ReactElement<Record<string, unknown>>;
    title: ReactNode;
    children: ReactNode;
}) {
    return <Popover open={open} onOpenChange={onOpenChange}>
      {hint ? <Hint label={hint}><PopoverTrigger render={trigger}/></Hint> : <PopoverTrigger render={trigger}/>}
      <PopoverContent side="bottom" align="end" sideOffset={6} data-scroll className="z-50 w-80 rounded-lg border bg-popover p-2.5 text-xs text-popover-foreground shadow-md">
        <PopoverTitle className="sr-only">{title}</PopoverTitle>
        {children}
      </PopoverContent>
    </Popover>;
}
