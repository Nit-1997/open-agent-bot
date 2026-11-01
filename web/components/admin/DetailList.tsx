export function DetailList({ id, items }: { id: string; items: Array<[key: string, label: string, value: string]> }) {
  return (
    <dl id={id} className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 rounded-xl bg-surface px-3 py-2 text-[12px]">
      {items.map(([key, label, value]) => (
        <div id={`${id}-${key}`} key={key} className="contents">
          <dt id={`${id}-${key}-label`} className="text-text-muted">
            {label}
          </dt>
          <dd id={`${id}-${key}-value`} className="whitespace-pre-wrap break-words text-text-secondary">
            {value}
          </dd>
        </div>
      ))}
    </dl>
  );
}
