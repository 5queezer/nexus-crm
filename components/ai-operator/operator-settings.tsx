"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import {
	Cable,
	Check,
	ChevronDown,
	ChevronUp,
	KeyRound,
	Loader2,
	Plus,
	RefreshCw,
	Save,
	Settings2,
	Trash2,
	X,
} from "lucide-react";
import {
	apiJson,
	Connector,
	Credential,
	McpTool,
	ProviderOption,
} from "./types";

type SettingsProps = {
	providers: ProviderOption[];
	credentials: Credential[];
	onCredentialUpsert: (credential: Credential) => void;
	onCredentialRemove: (provider: Credential["provider"]) => void;
	onClose: () => void;
};

type ConnectorForm = {
	id?: string;
	name: string;
	url: string;
	authorization: string;
	enabled: boolean;
};

const EMPTY_CONNECTOR: ConnectorForm = {
	name: "",
	url: "",
	authorization: "",
	enabled: true,
};

function inputClass() {
	return "h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-indigo-400 focus:ring-3 focus:ring-indigo-500/10 dark:border-white/10 dark:bg-white/[0.04] dark:text-white dark:placeholder:text-slate-600";
}

function includeConfiguredModel(
	items: ProviderOption["models"],
	configuredModel?: string,
): ProviderOption["models"] {
	return configuredModel && !items.some((item) => item.id === configuredModel)
		? [
				{ id: configuredModel, label: configuredModel, description: "" },
				...items,
			]
		: items;
}

export function OperatorSettings({
	providers,
	credentials,
	onCredentialUpsert,
	onCredentialRemove,
	onClose,
}: SettingsProps) {
	const t = useTranslations("ai_operator");
	const [tab, setTab] = useState<"models" | "connectors">("models");
	const [connectors, setConnectors] = useState<Connector[]>([]);
	const [connectorForm, setConnectorForm] =
		useState<ConnectorForm>(EMPTY_CONNECTOR);
	const [expandedConnector, setExpandedConnector] = useState<string | null>(
		null,
	);
	const [tools, setTools] = useState<Record<string, McpTool[]>>({});
	const [loadingTools, setLoadingTools] = useState<string | null>(null);
	const [busy, setBusy] = useState<string | null>(null);
	const [error, setError] = useState("");

	useEffect(() => {
		if (tab !== "connectors") return;
		apiJson<{ connectors: Connector[] }>("/api/agent/connectors")
			.then((result) => setConnectors(result.connectors))
			.catch((reason: unknown) =>
				setError(reason instanceof Error ? reason.message : t("error_generic")),
			);
	}, [tab, t]);

	async function loadTools(connector: Connector) {
		if (expandedConnector === connector.id) {
			setExpandedConnector(null);
			return;
		}
		setExpandedConnector(connector.id);
		if (tools[connector.id]) return;
		setLoadingTools(connector.id);
		setError("");
		try {
			const result = await apiJson<{
				tools: McpTool[];
				health: Pick<
					Connector,
					"lastCheckedAt" | "lastStatus" | "lastErrorCode"
				>;
			}>(`/api/agent/connectors/${connector.id}/tools`);
			setTools((current) => ({ ...current, [connector.id]: result.tools }));
			setConnectors((current) =>
				current.map((item) =>
					item.id === connector.id ? { ...item, ...result.health } : item,
				),
			);
		} catch (reason) {
			setConnectors((current) =>
				current.map((item) =>
					item.id === connector.id
						? {
								...item,
								lastCheckedAt: new Date().toISOString(),
								lastStatus: "failed",
								lastErrorCode: "DISCOVERY_FAILED",
							}
						: item,
				),
			);
			setError(reason instanceof Error ? reason.message : t("error_generic"));
		} finally {
			setLoadingTools(null);
		}
	}

	async function saveConnector() {
		if (!connectorForm.name.trim() || !connectorForm.url.trim()) return;
		setBusy("connector");
		setError("");
		try {
			const body = {
				name: connectorForm.name,
				url: connectorForm.url,
				enabled: connectorForm.enabled,
				...(connectorForm.authorization.trim()
					? { authorization: connectorForm.authorization }
					: {}),
			};
			const result = await apiJson<{ connector: Connector }>(
				connectorForm.id
					? `/api/agent/connectors/${connectorForm.id}`
					: "/api/agent/connectors",
				{
					method: connectorForm.id ? "PUT" : "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify(body),
				},
			);
			setConnectors((current) => {
				const exists = current.some((item) => item.id === result.connector.id);
				return exists
					? current.map((item) =>
							item.id === result.connector.id ? result.connector : item,
						)
					: [...current, result.connector].sort((a, b) =>
							a.name.localeCompare(b.name),
						);
			});
			setTools((current) => {
				const next = { ...current };
				delete next[result.connector.id];
				return next;
			});
			setConnectorForm(EMPTY_CONNECTOR);
		} catch (reason) {
			setError(reason instanceof Error ? reason.message : t("error_generic"));
		} finally {
			setBusy(null);
		}
	}

	async function deleteConnector(id: string) {
		setBusy(id);
		setError("");
		try {
			await apiJson<void>(`/api/agent/connectors/${id}`, { method: "DELETE" });
			setConnectors((current) => current.filter((item) => item.id !== id));
			setTools((current) => {
				const next = { ...current };
				delete next[id];
				return next;
			});
			if (expandedConnector === id) setExpandedConnector(null);
			if (connectorForm.id === id) setConnectorForm(EMPTY_CONNECTOR);
		} catch (reason) {
			setError(reason instanceof Error ? reason.message : t("error_generic"));
		} finally {
			setBusy(null);
		}
	}

	return (
		<div className="absolute inset-0 z-20 flex flex-col bg-white dark:bg-[#0f1011]">
			<div className="flex h-16 shrink-0 items-center justify-between border-b border-slate-200 px-5 dark:border-white/8">
				<div className="flex items-center gap-3">
					<span className="flex h-9 w-9 items-center justify-center rounded-xl bg-indigo-50 text-sm font-semibold text-slate-900 dark:bg-indigo-500/10 dark:text-indigo-300">
						<Settings2 className="h-4 w-4" />
					</span>
					<div>
						<h2 className="text-sm font-semibold text-slate-950 dark:text-white">
							{t("settings_title")}
						</h2>
						<p className="text-xs text-slate-500 dark:text-slate-500">
							{t("settings_subtitle")}
						</p>
					</div>
				</div>
				<button
					onClick={onClose}
					className="flex h-9 w-9 items-center justify-center rounded-xl text-slate-500 hover:bg-slate-100 dark:hover:bg-white/5"
					aria-label={t("close")}
				>
					<X className="h-4 w-4" />
				</button>
			</div>

			<div className="flex shrink-0 gap-1 border-b border-slate-200 px-5 pt-3 dark:border-white/8">
				{(["models", "connectors"] as const).map((item) => (
					<button
						key={item}
						onClick={() => {
							setTab(item);
							setError("");
						}}
						className={`flex items-center gap-2 border-b-2 px-3 pb-3 text-sm font-medium transition ${tab === item ? "border-indigo-500 text-indigo-600 dark:text-indigo-300" : "border-transparent text-slate-500 hover:text-slate-900 dark:hover:text-white"}`}
					>
						{item === "models" ? (
							<KeyRound className="h-4 w-4" />
						) : (
							<Cable className="h-4 w-4" />
						)}
						{t(item === "models" ? "models_tab" : "connectors_tab")}
					</button>
				))}
			</div>

			<div className="flex-1 overflow-y-auto p-5">
				{error && (
					<div
						role="alert"
						className="mb-4 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700 dark:border-red-500/20 dark:bg-red-500/10 dark:text-red-300"
					>
						{error}
					</div>
				)}
				{tab === "models" ? (
					<div className="mx-auto max-w-xl space-y-4">
						<div>
							<h3 className="text-sm font-semibold text-slate-900 dark:text-white">
								{t("models_title")}
							</h3>
							<p className="mt-1 text-xs leading-5 text-slate-500">
								{t("models_description")}
							</p>
						</div>
						{providers.map((provider) => (
							<CredentialCard
								key={provider.id}
								provider={provider}
								credential={credentials.find(
									(item) => item.provider === provider.id,
								)}
								onSaved={onCredentialUpsert}
								onDeleted={() => onCredentialRemove(provider.id)}
							/>
						))}
					</div>
				) : (
					<div className="mx-auto max-w-xl space-y-5">
						<div>
							<h3 className="text-sm font-semibold text-slate-900 dark:text-white">
								{t("connectors_title")}
							</h3>
							<p className="mt-1 text-xs leading-5 text-slate-500">
								{t("connectors_description")}
							</p>
						</div>
						<div className="rounded-2xl border border-slate-200 bg-slate-50/70 p-4 dark:border-white/8 dark:bg-white/[0.025]">
							<div className="mb-3 flex items-center justify-between">
								<span className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">
									{connectorForm.id ? t("edit_connector") : t("add_connector")}
								</span>
								{connectorForm.id && (
									<button
										onClick={() => setConnectorForm(EMPTY_CONNECTOR)}
										className="text-xs text-slate-500 hover:text-slate-900 dark:hover:text-white"
									>
										{t("cancel")}
									</button>
								)}
							</div>
							<div className="grid gap-3 sm:grid-cols-2">
								<input
									aria-label={t("connector_name")}
									className={inputClass()}
									placeholder={t("connector_name")}
									value={connectorForm.name}
									onChange={(event) =>
										setConnectorForm((current) => ({
											...current,
											name: event.target.value,
										}))
									}
								/>
								<input
									aria-label={t("connector_url")}
									className={inputClass()}
									placeholder="https://mcp.example.com"
									type="url"
									value={connectorForm.url}
									onChange={(event) =>
										setConnectorForm((current) => ({
											...current,
											url: event.target.value,
										}))
									}
								/>
							</div>
							<input
								aria-label={
									connectorForm.id
										? t("authorization_keep")
										: t("authorization_optional")
								}
								className={`${inputClass()} mt-3`}
								placeholder={
									connectorForm.id
										? t("authorization_keep")
										: t("authorization_optional")
								}
								type="password"
								value={connectorForm.authorization}
								onChange={(event) =>
									setConnectorForm((current) => ({
										...current,
										authorization: event.target.value,
									}))
								}
							/>
							<div className="mt-3 flex items-center justify-between">
								<label className="flex items-center gap-2 text-xs font-medium text-slate-600 dark:text-slate-400">
									<input
										type="checkbox"
										checked={connectorForm.enabled}
										onChange={(event) =>
											setConnectorForm((current) => ({
												...current,
												enabled: event.target.checked,
											}))
										}
										className="h-4 w-4 accent-indigo-600"
									/>
									{t("enabled")}
								</label>
								<button
									aria-label={t("save_connector")}
									onClick={saveConnector}
									disabled={
										busy === "connector" ||
										!connectorForm.name.trim() ||
										!connectorForm.url.trim()
									}
									className="flex h-9 items-center gap-2 rounded-xl bg-slate-950 px-3 text-xs font-semibold text-white transition hover:bg-indigo-600 disabled:opacity-40 dark:bg-indigo-500 dark:hover:bg-indigo-400"
								>
									{busy === "connector" ? (
										<Loader2 className="h-3.5 w-3.5 animate-spin" />
									) : connectorForm.id ? (
										<Save className="h-3.5 w-3.5" />
									) : (
										<Plus className="h-3.5 w-3.5" />
									)}
									{t("save")}
								</button>
							</div>
						</div>
						<div className="space-y-2">
							{connectors.length === 0 && (
								<div className="rounded-2xl border border-dashed border-slate-200 px-5 py-8 text-center text-xs text-slate-500 dark:border-white/10">
									{t("connectors_empty")}
								</div>
							)}
							{connectors.map((connector) => (
								<div
									key={connector.id}
									className="overflow-hidden rounded-2xl border border-slate-200 bg-white dark:border-white/8 dark:bg-white/[0.02]"
								>
									<div className="flex items-center gap-3 p-3">
										<span
											className={`h-2 w-2 rounded-full ${!connector.enabled ? "bg-slate-300 dark:bg-slate-700" : connector.lastStatus === "failed" ? "bg-red-500" : connector.lastStatus === "healthy" ? "bg-emerald-500" : "bg-amber-400"}`}
										/>
										<button
											aria-expanded={expandedConnector === connector.id}
											aria-controls={`connector-tools-${connector.id}`}
											aria-label={t(
												expandedConnector === connector.id
													? "hide_connector_tools"
													: "show_connector_tools",
												{ name: connector.name },
											)}
											className="flex min-w-0 flex-1 items-center text-left"
											onClick={() => loadTools(connector)}
										>
											<span className="min-w-0 flex-1">
												<span className="block truncate text-sm font-medium text-slate-900 dark:text-white">
													{connector.name}
												</span>
												<span className="block truncate text-[11px] text-slate-500">
													{connector.url} ·{" "}
													{t(
														!connector.enabled
															? "connector_status_disabled"
															: connector.lastStatus === "healthy"
																? "connector_status_healthy"
																: connector.lastStatus === "failed"
																	? "connector_status_failed"
																	: "connector_status_unchecked",
													)}
												</span>
											</span>
											{expandedConnector === connector.id ? (
												<ChevronUp className="h-4 w-4 text-slate-400" />
											) : (
												<ChevronDown className="h-4 w-4 text-slate-400" />
											)}
										</button>
										<button
											aria-label={t("edit_connector_named", {
												name: connector.name,
											})}
											onClick={() =>
												setConnectorForm({
													id: connector.id,
													name: connector.name,
													url: connector.url,
													authorization: "",
													enabled: connector.enabled,
												})
											}
											className="rounded-lg px-2 py-1 text-xs text-slate-500 hover:bg-slate-100 dark:hover:bg-white/5"
										>
											{t("edit")}
										</button>
										<button
											aria-label={t("delete_connector_named", {
												name: connector.name,
											})}
											onClick={() => deleteConnector(connector.id)}
											disabled={busy === connector.id}
											className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-500/10"
										>
											<Trash2 className="h-3.5 w-3.5" />
										</button>
									</div>
									{expandedConnector === connector.id && (
										<div
											id={`connector-tools-${connector.id}`}
											className="border-t border-slate-100 bg-slate-50/70 px-4 py-3 dark:border-white/5 dark:bg-black/10"
										>
											{loadingTools === connector.id ? (
												<div className="flex items-center gap-2 text-xs text-slate-500">
													<RefreshCw className="h-3.5 w-3.5 animate-spin" />
													{t("discovering_tools")}
												</div>
											) : (tools[connector.id]?.length ?? 0) > 0 ? (
												<div className="flex flex-wrap gap-2">
													{tools[connector.id].map((tool) => (
														<span
															key={tool.name}
															title={tool.description}
															className="rounded-lg border border-slate-200 bg-white px-2 py-1 text-[11px] font-medium text-slate-600 dark:border-white/8 dark:bg-white/5 dark:text-slate-300"
														>
															{tool.name}
														</span>
													))}
												</div>
											) : (
												<p className="text-xs text-slate-500">
													{t("no_tools")}
												</p>
											)}
										</div>
									)}
								</div>
							))}
						</div>
					</div>
				)}
			</div>
		</div>
	);
}

function CredentialCard({
	provider,
	credential,
	onSaved,
	onDeleted,
}: {
	provider: ProviderOption;
	credential?: Credential;
	onSaved: (credential: Credential) => void;
	onDeleted: () => void;
}) {
	const t = useTranslations("ai_operator");
	const [model, setModel] = useState(
		credential?.defaultModel ?? provider.models[0]?.id ?? "",
	);
	const [manualModel, setManualModel] = useState(
		credential?.defaultModel ?? "",
	);
	const configuredModel = credential?.defaultModel;
	const [models, setModels] = useState(() =>
		includeConfiguredModel(provider.models, configuredModel),
	);
	const [apiKey, setApiKey] = useState("");
	const apiKeyRef = useRef("");
	const discoveredKeyRef = useRef<string | null>(null);
	const discoveryGeneration = useRef(0);
	const [editing, setEditing] = useState(!credential);
	const [busy, setBusy] = useState(false);
	const [loadingModels, setLoadingModels] = useState(false);
	const [error, setError] = useState("");
	const selectedModel = useMemo(
		() => models.find((item) => item.id === model),
		[model, models],
	);
	useEffect(() => {
		setModel(configuredModel ?? provider.models[0]?.id ?? "");
		setManualModel(configuredModel ?? "");
		setModels(includeConfiguredModel(provider.models, configuredModel));
		setApiKey("");
		apiKeyRef.current = "";
		discoveredKeyRef.current = null;
		discoveryGeneration.current += 1;
	}, [provider.id, provider.models, configuredModel]);

	async function loadModels() {
		const requestedKey = apiKey.trim();
		const generation = ++discoveryGeneration.current;
		setLoadingModels(true);
		setError("");
		try {
			const response = await apiJson<{ models: ProviderOption["models"] }>(
				"/api/agent/provider-models",
				{
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({
						provider: provider.id,
						...(requestedKey ? { apiKey: requestedKey } : {}),
					}),
				},
			);
			if (
				generation !== discoveryGeneration.current ||
				apiKeyRef.current.trim() !== requestedKey
			)
				return;
			const nextModels = includeConfiguredModel(
				response.models,
				configuredModel,
			);
			discoveredKeyRef.current = requestedKey;
			setModels(nextModels);
			if (nextModels.length > 0) {
				setManualModel("");
				setModel((current) =>
					nextModels.some((item) => item.id === current)
						? current
						: (nextModels[0]?.id ?? ""),
				);
			}
		} catch (reason) {
			if (
				generation !== discoveryGeneration.current ||
				apiKeyRef.current.trim() !== requestedKey
			)
				return;
			setError(reason instanceof Error ? reason.message : t("error_generic"));
		} finally {
			if (generation === discoveryGeneration.current) setLoadingModels(false);
		}
	}

	async function save() {
		const resolvedModel = models.length === 0 ? manualModel.trim() : model;
		if (!resolvedModel) {
			setError(t("model_placeholder"));
			return;
		}
		if (!credential && apiKey.trim().length < 8) {
			setError(t("api_key_placeholder"));
			return;
		}

		setBusy(true);
		setError("");
		try {
			const result = await apiJson<{ credential: Credential }>(
				"/api/agent/credentials",
				{
					method: "PUT",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({
						provider: provider.id,
						model: resolvedModel,
						...(apiKey.trim() ? { apiKey: apiKey.trim() } : {}),
					}),
				},
			);
			onSaved(result.credential);
			setApiKey("");
			apiKeyRef.current = "";
			discoveredKeyRef.current = null;
			discoveryGeneration.current += 1;
			setEditing(false);
			setManualModel(result.credential.defaultModel);
			setModel(result.credential.defaultModel);
		} catch (reason) {
			setError(reason instanceof Error ? reason.message : t("error_generic"));
		} finally {
			setBusy(false);
		}
	}

	async function remove() {
		setBusy(true);
		setError("");
		try {
			await apiJson<void>(`/api/agent/credentials?provider=${provider.id}`, {
				method: "DELETE",
			});
			onDeleted();
			apiKeyRef.current = "";
			discoveredKeyRef.current = null;
			discoveryGeneration.current += 1;
			setEditing(true);
			setModel("");
		} catch (reason) {
			setError(reason instanceof Error ? reason.message : t("error_generic"));
		} finally {
			setBusy(false);
		}
	}

	return (
		<div className="rounded-2xl border border-slate-200 bg-white p-4 dark:border-white/8 dark:bg-white/[0.025]">
			<div className="flex items-start justify-between gap-3">
				<div className="flex items-center gap-3">
					<span className="flex h-9 w-9 items-center justify-center rounded-xl bg-slate-100 text-sm font-semibold text-slate-900 dark:bg-white/5 dark:text-white">
						{provider.label.slice(0, 1)}
					</span>
					<div>
						<div className="flex items-center gap-2">
							<h4 className="text-sm font-semibold text-slate-900 dark:text-white">
								{provider.label}
							</h4>
							{credential && (
								<span className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider text-emerald-600 dark:text-emerald-400">
									<Check className="h-3 w-3" />
									{t("configured")}
								</span>
							)}
						</div>
						<p className="mt-0.5 text-[11px] text-slate-500">
							{credential
								? `${credential.defaultModel} · ${credential.keyHint}`
								: t("not_configured")}
						</p>
					</div>
				</div>
				{credential && !editing && (
					<button
						onClick={() => setEditing(true)}
						className="rounded-lg px-2 py-1 text-xs text-slate-500 hover:bg-slate-100 dark:hover:bg-white/5"
					>
						{t("edit")}
					</button>
				)}
			</div>
			{editing && (
				<div className="mt-4 space-y-3">
					<div className="flex items-center gap-2">
						<select
							aria-label={t("model_label", { provider: provider.label })}
							className={inputClass()}
							value={model}
							onChange={(event) => setModel(event.target.value)}
						>
							{models.length > 0 ? (
								models.map((item) => (
									<option key={item.id} value={item.id}>
										{item.label}
									</option>
								))
							) : (
								<option value="">{t("no_models")}</option>
							)}
						</select>
						<button
							type="button"
							aria-label={t("refresh_models")}
							onClick={() => void loadModels()}
							disabled={loadingModels || busy}
							className="flex h-10 items-center gap-2 rounded-xl border border-slate-200 px-3 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-40 dark:border-white/10 dark:text-slate-200"
						>
							{loadingModels ? (
								<Loader2 className="h-3.5 w-3.5 animate-spin" />
							) : (
								<RefreshCw className="h-3.5 w-3.5" />
							)}
							{t("refresh")}
						</button>
					</div>
					{selectedModel ? (
						<p className="mt-1.5 text-[11px] text-slate-500">
							{selectedModel.description}
						</p>
					) : models.length > 0 ? null : (
						<input
							aria-label={t("model_label", { provider: provider.label })}
							className={inputClass()}
							value={manualModel}
							onChange={(event) => setManualModel(event.target.value)}
							placeholder={t("model_placeholder", { provider: provider.label })}
						/>
					)}
				</div>
			)}
			{editing && (
				<>
					<input
						aria-label={t("api_key_label", { provider: provider.label })}
						className={inputClass()}
						type="password"
						value={apiKey}
						onChange={(event) => {
							const nextKey = event.target.value;
							apiKeyRef.current = nextKey;
							discoveryGeneration.current += 1;
							setLoadingModels(false);
							if (
								discoveredKeyRef.current !== null &&
								nextKey.trim() !== discoveredKeyRef.current
							) {
								const defaultModels = includeConfiguredModel(
									provider.models,
									configuredModel,
								);
								discoveredKeyRef.current = null;
								setModels(defaultModels);
								setModel(configuredModel ?? defaultModels[0]?.id ?? "");
								setManualModel(configuredModel ?? "");
							}
							setApiKey(nextKey);
						}}
						placeholder={t("api_key_placeholder")}
						autoComplete="off"
					/>
					<button
						type="button"
						aria-label={t("refresh_models")}
						onClick={() => void loadModels()}
						disabled={loadingModels || busy || apiKey.trim().length === 0}
						className="mt-2 h-10 rounded-xl bg-slate-200 px-3 text-xs font-semibold text-slate-700 disabled:opacity-40 dark:bg-white/10 dark:text-slate-200"
					>
						{t("load_models")}
					</button>
				</>
			)}
			{!editing && (
				<p className="mt-4 text-[11px] text-slate-500">{t("manual_hint")}</p>
			)}
			{editing && (
				<>
					{error && (
						<p role="alert" className="text-xs text-red-600 dark:text-red-400">
							{error}
						</p>
					)}
					<div className="flex items-center justify-between">
						<div>
							{credential && (
								<button
									onClick={remove}
									disabled={busy}
									className="flex items-center gap-1.5 text-xs font-medium text-red-600 hover:text-red-700"
								>
									<Trash2 className="h-3.5 w-3.5" />
									{t("remove")}
								</button>
							)}
						</div>
						<div className="flex gap-2">
							{credential && (
								<button
									onClick={() => setEditing(false)}
									className="h-9 rounded-xl px-3 text-xs font-medium text-slate-500 hover:bg-slate-100 dark:hover:bg-white/5"
								>
									{t("cancel")}
								</button>
							)}
							<button
								onClick={save}
								disabled={
									busy ||
									(models.length > 0
										? !model
										: manualModel.trim().length < 1) ||
									loadingModels ||
									(!credential && apiKey.trim().length < 8)
								}
								className="flex h-9 items-center gap-2 rounded-xl bg-slate-950 px-3 text-xs font-semibold text-white hover:bg-indigo-600 disabled:opacity-40 dark:bg-indigo-500"
							>
								{busy ? (
									<Loader2 className="h-3.5 w-3.5 animate-spin" />
								) : (
									<Save className="h-3.5 w-3.5" />
								)}
								{t("save")}
							</button>
						</div>
					</div>
				</>
			)}
		</div>
	);
}
