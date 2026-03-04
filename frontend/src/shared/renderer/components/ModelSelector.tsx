"use client";

import { useCallback, useEffect, useState } from "react";
import type { LLMModelInfo } from "../lib/types";

interface ModelSelectorProps {
  provider: string;
  value: string;
  onChange: (model: string) => void;
  fetchModels: (provider: string) => Promise<LLMModelInfo[]>;
  placeholder?: string;
  className?: string;
}

export function ModelSelector({
  provider,
  value,
  onChange,
  fetchModels,
  placeholder,
  className,
}: ModelSelectorProps) {
  const [models, setModels] = useState<LLMModelInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [customMode, setCustomMode] = useState(false);

  const loadModels = useCallback(async () => {
    if (!provider) return;
    setLoading(true);
    try {
      const result = await fetchModels(provider);
      setModels(result);
      setCustomMode(false);
    } catch {
      setModels([]);
    } finally {
      setLoading(false);
    }
  }, [provider, fetchModels]);

  useEffect(() => {
    void loadModels();
  }, [loadModels]);

  const valueInList = models.some((m) => m.id === value);
  const showCustomInput = customMode || (value && !valueInList && models.length > 0);

  if (showCustomInput) {
    return (
      <div className="flex gap-1.5">
        <input
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder || "Enter model ID"}
          className={
            className ||
            "flex-1 h-9 px-3 bg-bg-input border border-border rounded-default text-sm text-fg-primary focus:outline-none focus:ring-1 focus:ring-focus-ring"
          }
        />
        <button
          type="button"
          onClick={() => {
            setCustomMode(false);
            if (models.length > 0) {
              const def = models.find((m) => m.is_default) || models[0];
              onChange(def.id);
            }
          }}
          className="h-9 px-2 text-xs text-fg-secondary hover:text-fg-primary border border-border rounded-default bg-bg-input"
          title="Switch back to dropdown"
        >
          List
        </button>
      </div>
    );
  }

  return (
    <div className="flex gap-1.5">
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={loading}
        className={
          className ||
          "flex-1 h-9 px-3 bg-bg-input border border-border rounded-default text-sm text-fg-primary focus:outline-none focus:ring-1 focus:ring-focus-ring"
        }
      >
        {loading && <option value="">Loading models...</option>}
        {!loading && models.length === 0 && (
          <option value={value}>{value || "No models available"}</option>
        )}
        {models.map((m) => (
          <option key={m.id} value={m.id}>
            {m.name}
            {m.context_window ? ` (${(m.context_window / 1000).toFixed(0)}K)` : ""}
            {m.is_default ? " *" : ""}
          </option>
        ))}
      </select>
      <button
        type="button"
        onClick={() => setCustomMode(true)}
        className="h-9 px-2 text-xs text-fg-secondary hover:text-fg-primary border border-border rounded-default bg-bg-input"
        title="Enter a custom model ID"
      >
        Custom
      </button>
    </div>
  );
}
