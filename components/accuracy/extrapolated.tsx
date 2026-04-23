/**
 * Wraps an estimated/computed value with a tiny asterisk superscript that
 * explains — on hover — how the value was derived. Use sparingly: only
 * values NOT pulled verbatim from a source document.
 */
export function Extrapolated({
  children,
  method,
}: {
  children: React.ReactNode;
  method: string;
}) {
  return (
    <span className="relative inline-flex items-baseline gap-0.5">
      <span>{children}</span>
      <sup
        title={`Estimated — calculated from ${method}`}
        className="text-[9px] text-ink-faint cursor-help"
        aria-label={`Estimated — calculated from ${method}`}
      >
        *
      </sup>
    </span>
  );
}
