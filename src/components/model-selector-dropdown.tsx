'use client';

import { PROVIDER_GROUPS } from '@/lib/providers';
import { useModelSelection } from '@/hooks/use-model-selection';
import { cn } from '@/lib/utils';

export function ModelSelectorDropdown() {
  const { provider, model, selectModel } = useModelSelection();

  return (
    <select
      className={cn(
        'md:hidden text-sm border rounded-md px-2 py-1 bg-background',
        'focus:outline-none focus-visible:ring-2 focus-visible:ring-primary'
      )}
      value={`${provider}:${model}`}
      onChange={(event) => {
        const [nextProvider, nextModel] = event.target.value.split(':');
        selectModel(nextProvider as any, nextModel);
      }}
    >
      {PROVIDER_GROUPS.map((group) => (
        <optgroup key={group.id} label={group.name}>
          {group.models.map((option) => (
            <option
              key={`${option.providerId}:${option.id}`}
              value={`${option.providerId}:${option.id}`}
              disabled={!option.available || option.comingSoon}
            >
              {option.label}
            </option>
          ))}
        </optgroup>
      ))}
    </select>
  );
}
