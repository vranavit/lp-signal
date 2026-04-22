"use client";

import * as React from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  saveFirmProfile,
  ASSET_CLASSES,
  FUND_STAGES,
  GEO_OPTIONS,
} from "./actions";

type Profile = {
  firm_name: string | null;
  asset_class_focus: string[];
  fund_stage: string | null;
  check_size_min_usd: number | null;
  check_size_max_usd: number | null;
  geographic_focus: string[];
};

export function FirmProfileForm({ initial }: { initial: Profile }) {
  const [isPending, startTransition] = React.useTransition();
  const [message, setMessage] = React.useState<
    { kind: "ok" | "err"; text: string } | null
  >(null);

  function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const fd = new FormData(form);
    startTransition(async () => {
      const res = await saveFirmProfile(fd);
      if (res.ok) {
        setMessage({ kind: "ok", text: "Saved." });
      } else {
        setMessage({ kind: "err", text: res.error ?? "Save failed." });
      }
    });
  }

  return (
    <form onSubmit={onSubmit} className="card-surface divide-y divide-line">
      {/* Firm name */}
      <FieldRow label="Firm name" hint="Displayed in outreach views.">
        <Input
          name="firm_name"
          defaultValue={initial.firm_name ?? ""}
          placeholder="Bloor Capital"
        />
      </FieldRow>

      {/* Asset classes */}
      <FieldRow
        label="Asset class focus"
        hint="Signals in these classes score highest on relevance."
      >
        <div className="flex flex-wrap gap-1.5">
          {ASSET_CLASSES.map((cls) => {
            const checked = initial.asset_class_focus.includes(cls);
            return <Chip key={cls} name="asset_class_focus" value={cls} defaultChecked={checked} />;
          })}
        </div>
      </FieldRow>

      {/* Fund stage */}
      <FieldRow label="Fund stage" hint="Your firm's current fund series maturity.">
        <div className="flex flex-wrap gap-1.5">
          {FUND_STAGES.map((stage) => (
            <Radio
              key={stage}
              name="fund_stage"
              value={stage}
              defaultChecked={initial.fund_stage === stage}
              label={stage}
            />
          ))}
        </div>
      </FieldRow>

      {/* Check size range */}
      <FieldRow
        label="Typical check size (USD)"
        hint="Min and max commitment your firm actively targets."
      >
        <div className="flex items-center gap-2">
          <Input
            name="check_size_min_usd"
            defaultValue={initial.check_size_min_usd ?? ""}
            inputMode="numeric"
            placeholder="1000000000"
            className="num"
          />
          <span className="text-[12px] text-ink-faint">to</span>
          <Input
            name="check_size_max_usd"
            defaultValue={initial.check_size_max_usd ?? ""}
            inputMode="numeric"
            placeholder="5000000000"
            className="num"
          />
        </div>
      </FieldRow>

      {/* Geography */}
      <FieldRow
        label="Geographic focus"
        hint="Plans whose country maps to one of these regions score higher."
      >
        <div className="flex flex-wrap gap-1.5">
          {GEO_OPTIONS.map((g) => (
            <Chip
              key={g}
              name="geographic_focus"
              value={g}
              defaultChecked={initial.geographic_focus.includes(g)}
            />
          ))}
        </div>
      </FieldRow>

      {/* Footer */}
      <div className="px-4 py-3 flex items-center justify-between">
        <div className="text-[12px]">
          {message?.kind === "ok" ? (
            <span className="text-accent-hi">{message.text}</span>
          ) : message?.kind === "err" ? (
            <span className="text-red-500">{message.text}</span>
          ) : (
            <span className="text-ink-faint">
              Changes take effect on the next signals query.
            </span>
          )}
        </div>
        <Button type="submit" variant="accent" disabled={isPending}>
          {isPending ? "Saving…" : "Save"}
        </Button>
      </div>
    </form>
  );
}

function FieldRow({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="grid grid-cols-[200px_1fr] gap-4 px-4 py-3">
      <div>
        <div className="text-[12px] font-medium text-ink">{label}</div>
        {hint ? (
          <div className="mt-0.5 text-[11px] text-ink-faint leading-snug">
            {hint}
          </div>
        ) : null}
      </div>
      <div>{children}</div>
    </div>
  );
}

function Chip({
  name,
  value,
  defaultChecked,
}: {
  name: string;
  value: string;
  defaultChecked?: boolean;
}) {
  return (
    <label className="inline-flex items-center gap-1.5 h-7 px-2 border border-line rounded-sm text-[12px] text-ink-muted hover:text-ink hover:border-line-strong cursor-pointer has-[:checked]:bg-accent/10 has-[:checked]:text-accent-hi has-[:checked]:border-accent">
      <input
        type="checkbox"
        name={name}
        value={value}
        defaultChecked={defaultChecked}
        className="sr-only"
      />
      {value}
    </label>
  );
}

function Radio({
  name,
  value,
  defaultChecked,
  label,
}: {
  name: string;
  value: string;
  defaultChecked?: boolean;
  label: string;
}) {
  return (
    <label className="inline-flex items-center gap-1.5 h-7 px-2 border border-line rounded-sm text-[12px] text-ink-muted hover:text-ink hover:border-line-strong cursor-pointer has-[:checked]:bg-accent/10 has-[:checked]:text-accent-hi has-[:checked]:border-accent capitalize">
      <input
        type="radio"
        name={name}
        value={value}
        defaultChecked={defaultChecked}
        className="sr-only"
      />
      {label}
    </label>
  );
}
