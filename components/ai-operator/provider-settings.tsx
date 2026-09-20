"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Check, Loader2, RefreshCw, Save, Trash2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { apiJson, type Credential, type ProviderOption } from "./types";

const MANUAL_MODEL = "__manual__";

function inputClass() {
	return "h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 outline-none transition focus:border-indigo-400 focus:ring-3 focus:ring-indigo-500/10 dark:border-white/10 dark:bg-white/[0.04] dark:text-white";
}

function includeConfiguredModel(
	items: ProviderOption["models"],
	configuredModel?: string,
): ProviderOption["models"] {
	return configuredModel && !items.some((item) => item.id === configuredModel)
		? [{ id: configuredModel, label: configuredModel, description: "" }, ...items]
		: items;
}

type ProviderSettingsProps = {
	providers: ProviderOption[];
	credentials: Credential[];
	onSaved: (credential: Credential) => void;
	onDeleted: (provider: Credential["provider"]) => void;
	onDirtyChange?: (dirty: boolean) => void;
};

export function ProviderSettings({
	providers,
	credentials,
	onSaved,
	onDeleted,
	onDirtyChange,
}: ProviderSettingsProps) {
	const t = useTranslations("ai_operator");
	const settingsT = useTranslations("settings.workspace");
	const [activeProvider, setActiveProvider] = useState<ProviderOption["id"] | null>(null);
	const [dirty, setDirty] = useState(false);
	const [editorBusy, setEditorBusy] = useState(false);
	const openerRefs = useRef<Partial<Record<ProviderOption["id"], HTMLButtonElement | null>>>({});

	useEffect(() => onDirtyChange?.(dirty), [dirty, onDirtyChange]);
	useEffect(() => () => onDirtyChange?.(false), [onDirtyChange]);

	function closeEditor(providerId: ProviderOption["id"], force = false) {
		if (editorBusy && !force) return;
		setEditorBusy(false);
		setActiveProvider(null);
		setDirty(false);
		if (force) setTimeout(() => openerRefs.current[providerId]?.focus(), 0);
		else openerRefs.current[providerId]?.focus();
	}

	function openEditor(providerId: ProviderOption["id"]) {
		if (editorBusy) return;
		if (activeProvider === providerId) {
			if (dirty && !window.confirm(settingsT("unsaved_changes"))) return;
			closeEditor(providerId);
			return;
		}
		if (activeProvider && dirty && !window.confirm(settingsT("unsaved_changes"))) return;
		setDirty(false);
		setEditorBusy(false);
		setActiveProvider(providerId);
	}

	return (
		<div
			className="@container divide-y divide-slate-200 border-y border-slate-200 dark:divide-white/8 dark:border-white/8"
			onKeyDown={(event) => {
				if (event.key !== "Escape" || !activeProvider) return;
				event.stopPropagation();
				if (!editorBusy) closeEditor(activeProvider);
			}}
		>
			{providers.map((provider) => {
				const credential = credentials.find((item) => item.provider === provider.id);
				const active = activeProvider === provider.id;
				const action = credential ? t("manage") : t("connect");
				return (
					<section key={provider.id}>
						<div className="grid min-h-18 grid-cols-[minmax(0,1fr)_auto] items-center gap-3 py-3 @min-[560px]:grid-cols-[minmax(140px,1fr)_minmax(140px,1fr)_auto]">
							<div className="flex min-w-0 items-center gap-3">
								<span aria-hidden="true" className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-sm font-semibold text-slate-900 dark:bg-white/5 dark:text-white">
									{provider.label.slice(0, 1)}
								</span>
								<h4 className="truncate text-sm font-semibold text-slate-900 dark:text-white">{provider.label}</h4>
							</div>
							<p className="col-start-1 ml-12 break-words text-xs leading-5 text-slate-500 dark:text-slate-400 @min-[560px]:col-start-2 @min-[560px]:row-start-1 @min-[560px]:ml-0">
								{credential ? `${t("configured")} · ${credential.defaultModel} · ${credential.keyHint}` : t("not_configured")}
							</p>
							<button
								ref={(node) => { openerRefs.current[provider.id] = node; }}
								type="button"
								aria-expanded={active}
								aria-controls={`provider-editor-${provider.id}`}
								aria-label={`${action} ${provider.label}`}
								onClick={() => openEditor(provider.id)}
								disabled={editorBusy}
								className="col-start-2 row-span-2 row-start-1 min-h-10 rounded-lg px-3 text-xs font-semibold text-indigo-600 hover:bg-indigo-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-500 dark:text-indigo-300 dark:hover:bg-indigo-500/10 @min-[560px]:col-start-3 @min-[560px]:row-span-1"
							>
								{action}
							</button>
						</div>
						{active && (
							<ProviderEditor
								key={provider.id}
								provider={provider}
								credential={credential}
								onDirtyChange={setDirty}
								onBusyChange={setEditorBusy}
								onCancel={() => closeEditor(provider.id)}
								onSaved={(next) => {
									onSaved(next);
									closeEditor(provider.id, true);
								}}
								onDeleted={() => {
									onDeleted(provider.id);
									closeEditor(provider.id, true);
								}}
							/>
						)}
					</section>
				);
			})}
		</div>
	);
}

function ProviderEditor({
	provider,
	credential,
	onDirtyChange,
	onBusyChange,
	onCancel,
	onSaved,
	onDeleted,
}: {
	provider: ProviderOption;
	credential?: Credential;
	onDirtyChange: (dirty: boolean) => void;
	onBusyChange: (busy: boolean) => void;
	onCancel: () => void;
	onSaved: (credential: Credential) => void;
	onDeleted: () => void;
}) {
	const t = useTranslations("ai_operator");
	const configuredModel = credential?.defaultModel;
	const initialModels = useMemo(
		() => includeConfiguredModel(provider.models, configuredModel),
		[provider.models, configuredModel],
	);
	const initialModel = configuredModel ?? initialModels[0]?.id ?? MANUAL_MODEL;
	const [models, setModels] = useState(initialModels);
	const [model, setModel] = useState(initialModel);
	const [manualModel, setManualModel] = useState(initialModels.length ? "" : (configuredModel ?? ""));
	const [apiKey, setApiKey] = useState("");
	const [loadingModels, setLoadingModels] = useState(false);
	const [saving, setSaving] = useState(false);
	const [error, setError] = useState("");
	const [discoveryComplete, setDiscoveryComplete] = useState(false);
	const [discoveryAttempted, setDiscoveryAttempted] = useState(false);
	const apiKeyRef = useRef("");
	const generationRef = useRef(0);
	const mountedRef = useRef(true);
	const apiKeyInputRef = useRef<HTMLInputElement>(null);
	const modelSelectRef = useRef<HTMLSelectElement>(null);
	const initialFocusTarget = useRef(credential ? "model" : "apiKey");

	const resolvedModel = model === MANUAL_MODEL ? manualModel.trim() : model;
	const initialResolvedModel = configuredModel ?? initialModels[0]?.id ?? "";
	const dirty = apiKey.length > 0 || resolvedModel !== initialResolvedModel;
	const replacementNeedsDiscovery =
		apiKey.trim().length > 0 &&
		!discoveryComplete &&
		!(discoveryAttempted && error && model === MANUAL_MODEL);
	const saveDisabled = saving || loadingModels || !resolvedModel || (!credential && apiKey.trim().length < 8) || replacementNeedsDiscovery;

	useEffect(() => {
		mountedRef.current = true;
		if (initialFocusTarget.current === "model") modelSelectRef.current?.focus();
		else apiKeyInputRef.current?.focus();
		return () => {
			mountedRef.current = false;
			generationRef.current += 1;
		};
	}, []);
	useEffect(() => () => onBusyChange(false), [onBusyChange]);
	useEffect(() => onDirtyChange(dirty), [dirty, onDirtyChange]);
	useEffect(() => onBusyChange(saving), [onBusyChange, saving]);

	async function discoverModels() {
		const requestedKey = apiKey.trim();
		const generation = ++generationRef.current;
		setLoadingModels(true);
		setError("");
		setDiscoveryComplete(false);
		setDiscoveryAttempted(true);
		try {
			const response = await apiJson<{ models: ProviderOption["models"] }>("/api/agent/provider-models", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ provider: provider.id, ...(requestedKey ? { apiKey: requestedKey } : {}) }),
			});
			if (!mountedRef.current || generation !== generationRef.current || apiKeyRef.current.trim() !== requestedKey) return;
			const nextModels = includeConfiguredModel(response.models, configuredModel);
			setModels(nextModels);
			setDiscoveryComplete(true);
			if (model === MANUAL_MODEL) {
				if (manualModel && nextModels.some((item) => item.id === manualModel))
					setModel(manualModel);
			} else if (!nextModels.some((item) => item.id === model)) {
				setManualModel(model);
				setModel(MANUAL_MODEL);
			}
		} catch (reason) {
			if (!mountedRef.current || generation !== generationRef.current || apiKeyRef.current.trim() !== requestedKey) return;
			setError(reason instanceof Error ? reason.message : t("error_generic"));
		} finally {
			if (mountedRef.current && generation === generationRef.current) setLoadingModels(false);
		}
	}

	async function save() {
		if (saveDisabled) return;
		setSaving(true);
		setError("");
		try {
			const result = await apiJson<{ credential: Credential }>("/api/agent/credentials", {
				method: "PUT",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ provider: provider.id, model: resolvedModel, ...(apiKey.trim() ? { apiKey: apiKey.trim() } : {}) }),
			});
			if (!mountedRef.current) return;
			apiKeyRef.current = "";
			setApiKey("");
			onSaved(result.credential);
		} catch (reason) {
			if (mountedRef.current) setError(reason instanceof Error ? reason.message : t("error_generic"));
		} finally {
			if (mountedRef.current) setSaving(false);
		}
	}

	async function remove() {
		setSaving(true);
		setError("");
		try {
			await apiJson<void>(`/api/agent/credentials?provider=${provider.id}`, { method: "DELETE" });
			if (mountedRef.current) onDeleted();
		} catch (reason) {
			if (mountedRef.current) setError(reason instanceof Error ? reason.message : t("error_generic"));
		} finally {
			if (mountedRef.current) setSaving(false);
		}
	}

	return (
		<div
			id={`provider-editor-${provider.id}`}
			className="pb-5 pl-0 @min-[560px]:pl-12"
			onKeyDown={(event) => {
				if (event.key !== "Escape" || saving) return;
				event.preventDefault();
				event.stopPropagation();
				onCancel();
			}}
		>
			<div className="grid gap-4 @min-[560px]:grid-cols-2">
				<label className="space-y-1.5 text-xs font-medium text-slate-700 dark:text-slate-300">
					<span>{t("api_key")}</span>
					<input
						ref={apiKeyInputRef}
						aria-label={t("api_key_label", { provider: provider.label })}
						className={inputClass()}
						type="password"
						disabled={saving}
						autoComplete="off"
						placeholder={credential ? t("api_key_keep") : t("api_key_placeholder")}
						value={apiKey}
						onChange={(event) => {
							const value = event.target.value;
							if (model === MANUAL_MODEL && initialModels.some((item) => item.id === manualModel.trim())) {
								setModel(manualModel.trim());
							}
							if (
								model !== MANUAL_MODEL &&
								!initialModels.some((item) => item.id === model)
							) {
								setManualModel(model);
								setModel(MANUAL_MODEL);
							}
							apiKeyRef.current = value;
							generationRef.current += 1;
							setApiKey(value);
							setLoadingModels(false);
				setDiscoveryComplete(false);
				setDiscoveryAttempted(false);
							setError("");
							setModels(initialModels);
						}}
					/>
				</label>
				<label className="space-y-1.5 text-xs font-medium text-slate-700 dark:text-slate-300">
					<span>{t("model")}</span>
					<select ref={modelSelectRef} aria-label={t("model_label", { provider: provider.label })} className={inputClass()} value={model} disabled={saving} onChange={(event) => setModel(event.target.value)}>
						{models.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
						<option value={MANUAL_MODEL}>{t("manual_model_option")}</option>
					</select>
				</label>
				{model === MANUAL_MODEL && (
					<label className="space-y-1.5 text-xs font-medium text-slate-700 dark:text-slate-300 @min-[560px]:col-start-2">
						<span>{t("manual_model_id")}</span>
						<input aria-label={t("manual_model_label", { provider: provider.label })} className={inputClass()} value={manualModel} disabled={saving} onChange={(event) => setManualModel(event.target.value)} />
					</label>
				)}
			</div>
			<div className="mt-3 flex flex-wrap items-center gap-3">
				<button
					type="button"
					aria-label={error ? t("retry_discovery") : t("check_discover")}
					onClick={() => void discoverModels()}
					disabled={loadingModels || saving || (!credential && apiKey.trim().length < 8)}
					className="flex min-h-10 items-center gap-2 rounded-lg border border-slate-200 px-3 text-xs font-semibold text-slate-700 hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-500 disabled:opacity-40 dark:border-white/10 dark:text-slate-200 dark:hover:bg-white/5"
				>
					{loadingModels ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
					{error ? t("retry") : t("check_discover")}
				</button>
				{loadingModels && <span role="status" className="text-xs text-slate-500">{t("discovering_models")}</span>}
				{discoveryComplete && <span role="status" className="flex items-center gap-1.5 text-xs text-emerald-700 dark:text-emerald-300"><Check className="h-3.5 w-3.5" />{t("models_loaded")}</span>}
			</div>
			{error && <p role="alert" className="mt-3 text-xs text-red-600 dark:text-red-400">{error}</p>}
			{error && model === MANUAL_MODEL && <p className="mt-2 text-xs text-amber-700 dark:text-amber-300">{t("manual_model_unverified")}</p>}
			<p className="mt-3 text-xs leading-5 text-slate-500">{credential ? t("replacement_key_optional") : t("discovery_before_save")}</p>
			<div className="mt-4 flex items-center justify-between gap-3">
				<div>{credential && <button type="button" onClick={() => void remove()} disabled={saving} className="flex min-h-10 items-center gap-1.5 rounded-lg px-2 text-xs font-medium text-red-600 hover:bg-red-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-500 dark:hover:bg-red-500/10"><Trash2 className="h-3.5 w-3.5" />{t("remove")}</button>}</div>
				<div className="flex gap-2">
					<button type="button" onClick={onCancel} disabled={saving} className="min-h-10 rounded-lg px-3 text-xs font-medium text-slate-600 hover:bg-slate-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-500 dark:text-slate-300 dark:hover:bg-white/5">{t("cancel")}</button>
					<button type="button" onClick={() => void save()} disabled={saveDisabled} className="flex min-h-10 items-center gap-2 rounded-lg bg-slate-950 px-3 text-xs font-semibold text-white hover:bg-indigo-600 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-500 disabled:opacity-40 dark:bg-indigo-500 dark:hover:bg-indigo-400">
						{saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}{t("save")}
					</button>
				</div>
			</div>
		</div>
	);
}
