"use client";

import { useCallback, useEffect, useState } from "react";
import { ArrowLeft } from "lucide-react";
import type { LLMSettings } from "../lib/types";
import { ModelSelector } from "./ModelSelector";

const PROVIDERS = [
  { value: "claude", label: "Claude (Anthropic)" },
  { value: "openai", label: "OpenAI" },
  { value: "gemini", label: "Gemini (Google)" },
  { value: "ollama", label: "Ollama (Local)" },
];

interface SettingsPanelProps {
  onBack: () => void;
  api: {
    getSettings: () => Promise<LLMSettings>;
    updateSettings: (data: Partial<LLMSettings>) => Promise<LLMSettings>;
    getProviderModels: (provider: string) => Promise<{ id: string; name: string; context_window: number | null; is_default: boolean }[]>;
  };
}

export function SettingsPanel({ onBack, api }: SettingsPanelProps) {
  const [llm, setLlm] = useState<LLMSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api
      .getSettings()
      .then((data) => {
        setLlm(data);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [api]);

  const save = useCallback(
    (partial: Partial<LLMSettings>) => {
      setLlm((prev) => (prev ? { ...prev, ...partial } : prev));
      setSaving(true);
      api
        .updateSettings(partial)
        .then(setLlm)
        .catch(() => {})
        .finally(() => setSaving(false));
    },
    [api],
  );

  if (loading) {
    return (
      <div className="min-h-screen px-6 pt-24 pb-16 container-dashboard">
        <p className="text-fg-secondary">Loading settings...</p>
      </div>
    );
  }

  if (!llm) {
    return (
      <div className="min-h-screen px-6 pt-24 pb-16 container-dashboard">
        <button onClick={onBack} className="flex items-center gap-1.5 text-sm text-fg-secondary hover:text-fg-primary mb-6">
          <ArrowLeft size={14} />
          Back
        </button>
        <p className="text-fg-secondary">Failed to load settings. Is the backend running?</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen px-6 pt-24 pb-16 container-dashboard animate-[fade-in_0.2s_ease-out]">
      <div className="flex items-center justify-between mb-8">
        <div className="flex items-center gap-3">
          <button onClick={onBack} className="flex items-center gap-1.5 text-sm text-fg-secondary hover:text-fg-primary">
            <ArrowLeft size={14} />
          </button>
          <h1 className="text-[28px] font-semibold tracking-[-0.045em] leading-none">
            Settings
          </h1>
        </div>
        {saving && <span className="text-xs text-fg-secondary">Saving...</span>}
      </div>

      <div className="space-y-6 max-w-xl">
        <section className="border border-border rounded-[var(--radius-default)] p-4 space-y-4">
          <h2 className="text-base font-medium">LLM Provider</h2>
          <label className="block">
            <span className="text-xs text-fg-secondary mb-1 block">Default Provider</span>
            <select
              value={llm.llm_provider}
              onChange={(e) => save({ llm_provider: e.target.value })}
              className="w-full h-9 px-3 bg-bg-secondary border border-border rounded-[var(--radius-default)] text-sm focus:outline-none focus:ring-1 focus:ring-focus-ring"
            >
              {PROVIDERS.map((p) => (
                <option key={p.value} value={p.value}>{p.label}</option>
              ))}
            </select>
          </label>
        </section>

        <ProviderSection
          title="Claude (Anthropic)"
          apiKeyValue={llm.anthropic_api_key}
          apiKeyPlaceholder="Anthropic API Key"
          onApiKeyChange={(v) => save({ anthropic_api_key: v })}
          provider="claude"
          model={llm.claude_model}
          onModelChange={(m) => save({ claude_model: m })}
          fetchModels={api.getProviderModels}
          modelPlaceholder="e.g. claude-sonnet-4-6"
        />

        <ProviderSection
          title="OpenAI"
          apiKeyValue={llm.openai_api_key}
          apiKeyPlaceholder="OpenAI API Key"
          onApiKeyChange={(v) => save({ openai_api_key: v })}
          provider="openai"
          model={llm.openai_model}
          onModelChange={(m) => save({ openai_model: m })}
          fetchModels={api.getProviderModels}
          modelPlaceholder="e.g. gpt-4o"
        />

        <ProviderSection
          title="Gemini (Google)"
          apiKeyValue={llm.google_api_key}
          apiKeyPlaceholder="Google API Key"
          onApiKeyChange={(v) => save({ google_api_key: v })}
          provider="gemini"
          model={llm.gemini_model}
          onModelChange={(m) => save({ gemini_model: m })}
          fetchModels={api.getProviderModels}
          modelPlaceholder="e.g. gemini-2.5-flash"
        />

        <section className="border border-border rounded-[var(--radius-default)] p-4 space-y-3">
          <h2 className="text-base font-medium">Ollama (Local)</h2>
          <label className="block">
            <span className="text-xs text-fg-secondary mb-1 block">Base URL</span>
            <input
              type="text"
              value={llm.ollama_base_url}
              onChange={(e) => save({ ollama_base_url: e.target.value })}
              placeholder="http://localhost:11434/v1"
              className="w-full h-9 px-3 bg-bg-secondary border border-border rounded-[var(--radius-default)] text-sm focus:outline-none focus:ring-1 focus:ring-focus-ring"
            />
          </label>
          <label className="block">
            <span className="text-xs text-fg-secondary mb-1 block">Model</span>
            <ModelSelector
              provider="ollama"
              value={llm.ollama_model}
              onChange={(m) => save({ ollama_model: m })}
              fetchModels={api.getProviderModels}
              placeholder="e.g. qwen2.5-coder:7b"
              className="w-full h-9 px-3 bg-bg-secondary border border-border rounded-[var(--radius-default)] text-sm focus:outline-none focus:ring-1 focus:ring-focus-ring"
            />
          </label>
        </section>
      </div>
    </div>
  );
}

function ProviderSection({
  title,
  apiKeyValue,
  apiKeyPlaceholder,
  onApiKeyChange,
  provider,
  model,
  onModelChange,
  fetchModels,
  modelPlaceholder,
}: {
  title: string;
  apiKeyValue: string;
  apiKeyPlaceholder: string;
  onApiKeyChange: (v: string) => void;
  provider: string;
  model: string;
  onModelChange: (m: string) => void;
  fetchModels: (provider: string) => Promise<{ id: string; name: string; context_window: number | null; is_default: boolean }[]>;
  modelPlaceholder: string;
}) {
  return (
    <section className="border border-border rounded-[var(--radius-default)] p-4 space-y-3">
      <h2 className="text-base font-medium">{title}</h2>
      <label className="block">
        <span className="text-xs text-fg-secondary mb-1 block">API Key</span>
        <input
          type="password"
          value={apiKeyValue}
          onChange={(e) => onApiKeyChange(e.target.value)}
          placeholder={apiKeyPlaceholder}
          className="w-full h-9 px-3 bg-bg-secondary border border-border rounded-[var(--radius-default)] text-sm focus:outline-none focus:ring-1 focus:ring-focus-ring"
        />
      </label>
      <label className="block">
        <span className="text-xs text-fg-secondary mb-1 block">Model</span>
        <ModelSelector
          provider={provider}
          value={model}
          onChange={onModelChange}
          fetchModels={fetchModels}
          placeholder={modelPlaceholder}
          className="w-full h-9 px-3 bg-bg-secondary border border-border rounded-[var(--radius-default)] text-sm focus:outline-none focus:ring-1 focus:ring-focus-ring"
        />
      </label>
    </section>
  );
}
