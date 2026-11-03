"use client";

import {
  FOOD,
  HOUSEHOLD,
  INDEPENDENT,
  KID_BANDS,
  KIDS_ANY,
  NO_AIRLINE,
  NO_DELIVERY,
  NO_FOOD_RULES,
  type OnboardingOptions,
  PET_KINDS,
  PETS_ANY,
  SHOPPING_STYLES,
  STAY_CHOICES,
  TRAVEL_STYLES,
} from "@oab/shared/onboarding";
import type { Profile } from "@oab/shared/profile";
import { addTag, detectedLine, toggle } from "@/lib/onboarding";
import { AddressField } from "./AddressField";
import { AddChip, Chip, type ChipOption, ChipRow, Row, SingleRow } from "./Chips";

type SectionProps = { id: string; profile: Profile; onChange: (p: Profile) => void; options: OnboardingOptions | null };

const opts = (values: string[]): ChipOption[] => values.map((value) => ({ value }));

function subToggle(list: string[], value: string, any: string): string[] {
  const next = toggle(
    list.filter((x) => x !== any),
    value,
  );
  return next.length ? next : [any];
}

export function YouSection({ id, profile, onChange, options }: SectionProps) {
  const h = profile.household;
  const setHousehold = (next: Partial<Profile["household"]>) => onChange({ ...profile, household: { ...h, ...next } });
  const alone = !h.partner && !h.kids.length && !h.pets.length && !h.other.length;
  return (
    <div id={id} className="space-y-1">
      <div id={`${id}-name`} className="space-y-1.5 border-b border-border pb-2">
        <label id={`${id}-name-label`} htmlFor={`${id}-name-input`} className="eyebrow block">
          Name
          <span id={`${id}-name-hint`} className="ml-2 normal-case tracking-normal text-text-faint">
            optional
          </span>
        </label>
        <input
          id={`${id}-name-input`}
          value={profile.name ?? ""}
          maxLength={80}
          onChange={(e) => onChange({ ...profile, name: e.target.value })}
          placeholder="Your name"
          className="w-full rounded-xl border border-border bg-paper px-3.5 py-2.5 text-[15px] text-text-primary outline-none transition placeholder:text-text-faint focus:border-mist-300"
        />
      </div>
      <div id={`${id}-home-row`} className="border-b border-border py-2">
        <AddressField
          id={`${id}-home`}
          home={profile.home}
          detected={detectedLine(profile.home, options)}
          onChange={(home) => onChange({ ...profile, home })}
        />
      </div>
      <Row id={`${id}-household`} label="Household">
        <Chip id={`${id}-household-alone`} on={alone} onClick={() => setHousehold({ partner: false, kids: [], pets: [], other: [] })}>
          {HOUSEHOLD.justMe}
        </Chip>
        <Chip id={`${id}-household-partner`} on={h.partner} onClick={() => setHousehold({ partner: !h.partner })}>
          {HOUSEHOLD.partner}
        </Chip>
        <Chip id={`${id}-household-kids`} on={h.kids.length > 0} onClick={() => setHousehold({ kids: h.kids.length ? [] : [KIDS_ANY] })}>
          {HOUSEHOLD.kids}
        </Chip>
        <Chip id={`${id}-household-pets`} on={h.pets.length > 0} onClick={() => setHousehold({ pets: h.pets.length ? [] : [PETS_ANY] })}>
          {HOUSEHOLD.pets}
        </Chip>
        {h.other.map((o, n) => (
          <Chip key={o} id={`${id}-household-other-${n}`} on onClick={() => setHousehold({ other: h.other.filter((x) => x !== o) })}>
            {o}
          </Chip>
        ))}
        <AddChip id={`${id}-household-add`} onAdd={(tag) => setHousehold({ other: addTag(h.other, tag) })} />
      </Row>
      {h.kids.length > 0 && (
        <Row id={`${id}-kids`} label="Kids' ages">
          {KID_BANDS.map((band, n) => (
            <Chip
              key={band}
              id={`${id}-kids-chip-${n}`}
              on={h.kids.includes(band)}
              onClick={() => setHousehold({ kids: subToggle(h.kids, band, KIDS_ANY) })}
            >
              {band}
            </Chip>
          ))}
        </Row>
      )}
      {h.pets.length > 0 && (
        <ChipRow
          id={`${id}-pets`}
          label="Pets"
          options={opts(PET_KINDS)}
          selected={h.pets.filter((p) => p !== PETS_ANY)}
          toggle={(list, v) => toggle(list, v)}
          onChange={(next) => setHousehold({ pets: next.length ? next : [PETS_ANY] })}
        />
      )}
      <ChipRow
        id={`${id}-food`}
        label="Food"
        options={opts(FOOD)}
        selected={profile.food}
        exclusive={[NO_FOOD_RULES]}
        toggle={(list, v) => toggle(list, v, [NO_FOOD_RULES])}
        onChange={(food) => onChange({ ...profile, food })}
      />
    </div>
  );
}

export function TravelSection({ id, profile, onChange, options }: SectionProps) {
  const t = profile.travel;
  const set = (next: Partial<Profile["travel"]>) => onChange({ ...profile, travel: { ...t, ...next } });
  const airports = options?.airports ?? [];
  const both = t.stays.length === 2;
  return (
    <div id={id}>
      <SingleRow id={`${id}-style`} label="Style" options={TRAVEL_STYLES} value={t.style} onChange={(style) => set({ style })} />
      <ChipRow
        id={`${id}-airlines`}
        label="Airlines you prefer"
        hint={airports.length ? `flying from ${airports.join(" / ")}` : undefined}
        options={opts([...(options?.rows.airlines ?? []), NO_AIRLINE])}
        selected={t.airlines}
        exclusive={[NO_AIRLINE]}
        toggle={(list, v) => toggle(list, v, [NO_AIRLINE])}
        onChange={(airlines) => set({ airlines })}
      />
      <Row id={`${id}-stays`} label="Where you stay">
        {STAY_CHOICES.map((c, n) => (
          <Chip
            key={c.id}
            id={`${id}-stays-chip-${n}`}
            on={t.stays.includes(c.id)}
            onClick={() => set({ stays: toggle(t.stays, c.id) as Profile["travel"]["stays"] })}
          >
            {c.label}
          </Chip>
        ))}
        <Chip id={`${id}-stays-either`} on={both} onClick={() => set({ stays: both ? [] : ["hotel", "rental"] })}>
          Either
        </Chip>
      </Row>
      <ChipRow
        id={`${id}-chains`}
        label="Hotel chains"
        hint="optional · loyalty counts"
        options={opts(options?.rows.hotelChains ?? [INDEPENDENT])}
        selected={t.hotelChains}
        toggle={(list, v) => toggle(list, v)}
        onChange={(hotelChains) => set({ hotelChains })}
      />
      <ChipRow
        id={`${id}-sites`}
        label="Sites you book on"
        hint="searched: prices read today · linked: a search link"
        options={(options?.rows.sites ?? []).map((s) => ({ value: s.label, access: s.access }))}
        selected={t.sites}
        toggle={(list, v) => toggle(list, v)}
        onChange={(sites) => set({ sites })}
      />
    </div>
  );
}

export function ShoppingSection({ id, profile, onChange, options }: SectionProps) {
  const s = profile.shopping;
  const set = (next: Partial<Profile["shopping"]>) => onChange({ ...profile, shopping: { ...s, ...next } });
  return (
    <div id={id}>
      <SingleRow id={`${id}-style`} label="Spending style" options={SHOPPING_STYLES} value={s.style} onChange={(style) => set({ style })} />
      <ChipRow
        id={`${id}-groceries`}
        label="Groceries from"
        hint={options?.groceriesNearby ? "popular near you" : undefined}
        options={opts(options?.rows.groceries ?? [])}
        selected={s.groceries}
        toggle={(list, v) => toggle(list, v)}
        onChange={(groceries) => set({ groceries })}
      />
      <ChipRow
        id={`${id}-retail`}
        label="Other shopping"
        options={opts(options?.rows.retail ?? [])}
        selected={s.retail}
        toggle={(list, v) => toggle(list, v)}
        onChange={(retail) => set({ retail })}
      />
      <ChipRow
        id={`${id}-delivery`}
        label="Delivery apps"
        options={opts([...(options?.rows.delivery ?? []), NO_DELIVERY])}
        selected={s.delivery}
        exclusive={[NO_DELIVERY]}
        toggle={(list, v) => toggle(list, v, [NO_DELIVERY])}
        onChange={(delivery) => set({ delivery })}
      />
    </div>
  );
}
