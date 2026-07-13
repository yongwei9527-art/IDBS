import { Check, Copy } from 'lucide-react';
import { useState, type HTMLAttributes } from 'react';
import { cn } from '@/lib/utils';

const UUID_PATTERN = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;

/** Returns the standard display name for an internal identifier. */
export function formatCompactId(value?: string | null, startChars = 8, endChars = 4, prefix?: string) {
  const fullValue = value?.trim() || '—';
  if (fullValue === '—') return fullValue;

  // UUIDs are technical primary keys. Their final four characters provide a
  // concise, consistent human-facing reference while the complete value stays copyable.
  if (UUID_PATTERN.test(fullValue)) return prefix ? `${prefix}-${fullValue.slice(-endChars)}` : `#${fullValue.slice(-endChars)}`;

  return fullValue.length > startChars + endChars + 3
    ? `${fullValue.slice(0, startChars)}…${fullValue.slice(-endChars)}`
    : fullValue;
}

type CompactIdProps = {
  value?: string | null;
  /** Number of characters retained at the beginning and end of long IDs. */
  startChars?: number;
  endChars?: number;
  /** Short business prefix that makes the ID easy to locate, e.g. REQ-3006. */
  prefix?: string;
} & Omit<HTMLAttributes<HTMLSpanElement>, 'children'>;

/**
 * Displays machine-generated identifiers using the shared short-ID naming rule
 * while keeping the complete value available via hover and a one-click copy action.
 */
export function CompactId({
  value,
  startChars = 8,
  endChars = 4,
  prefix,
  className,
  ...props
}: CompactIdProps) {
  const [copied, setCopied] = useState(false);
  const fullValue = value?.trim() || '—';
  const displayValue = formatCompactId(fullValue, startChars, endChars, prefix);
  const isCompact = displayValue !== fullValue;

  async function copyValue() {
    if (fullValue === '—' || !navigator.clipboard) return;
    try {
      await navigator.clipboard.writeText(fullValue);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      // Browsers can deny clipboard access in an insecure context. The full ID
      // remains accessible through the native title tooltip in that case.
    }
  }

  return (
    <span
      className={cn('inline-flex max-w-full items-center gap-1 align-middle font-mono tabular-nums', className)}
      title={fullValue === '—' ? undefined : fullValue}
      {...props}
    >
      <span className="min-w-0 truncate">{displayValue}</span>
      {isCompact ? (
        <button
          type="button"
          className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          aria-label={`复制完整 ID：${fullValue}`}
          title="复制完整 ID"
          onClick={copyValue}
        >
          {copied ? <Check className="h-3.5 w-3.5 text-emerald-600" /> : <Copy className="h-3.5 w-3.5" />}
        </button>
      ) : null}
    </span>
  );
}


