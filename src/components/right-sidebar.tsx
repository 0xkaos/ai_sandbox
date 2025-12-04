'use client';

import { PROVIDER_GROUPS, type ProviderId } from '@/lib/providers';
import { useModelSelection } from '@/hooks/use-model-selection';
import { cn } from '@/lib/utils';

export function RightSidebar() {
  const { provider, model, selectModel, isSaving, errorMessage } = useModelSelection();

  const handleSelect = async (providerId: ProviderId, modelId: string) => {
    await selectModel(providerId, modelId);
  };

  return (
    <aside className="hidden lg:flex w-72 border-l bg-muted/10 flex-col">
      <div className="px-4 py-3 border-b">
        <p className="text-sm font-medium">Model Selector</p>
        <p className="text-xs text-muted-foreground">Choose a provider for this conversation.</p>
      </div>
      <div className="flex-1 overflow-auto p-4 space-y-6">
        {PROVIDER_GROUPS.map((group) => (
          <div key={group.id} className="space-y-2">
            <div>
              <p className="text-sm font-semibold">{group.name}</p>
              <p className="text-xs text-muted-foreground">{group.description}</p>
            </div>
            <div className="space-y-2">
              {group.models.map((option) => {
                const isActive = provider === group.id && model === option.id;
                const disabled = !option.available || option.comingSoon;
                return (
                  <button
                    key={option.id}
                    type="button"
                    disabled={disabled || (isActive && isSaving)}
                    onClick={() => handleSelect(group.id, option.id)}
                    className={cn(
                      'w-full rounded-lg border px-3 py-2 text-left transition-colors',
                      isActive ? 'border-primary bg-primary/10' : 'border-border hover:border-primary/50',
                      disabled && 'opacity-50 cursor-not-allowed'
                    )}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-sm font-medium">
                        {option.label}
                        {option.comingSoon && <span className="ml-2 text-[11px] uppercase tracking-wide text-muted-foreground">Soon</span>}
                      </p>
                      {isActive && <span className="text-[11px] uppercase tracking-wide text-primary">Active</span>}
                    </div>
                    <p className="text-xs text-muted-foreground">{option.description}</p>
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>
      {isSaving && (
        <div className="px-4 py-2 text-center text-xs text-muted-foreground border-t">Syncing with server…</div>
      )}
      {errorMessage && (
        <div className="px-4 py-2 text-xs text-destructive border-t bg-destructive/10">
          {errorMessage}
        </div>
      )}
    </aside>
  );
}
