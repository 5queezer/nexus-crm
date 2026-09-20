"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import {
	Cable,
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
import { ProviderSettings } from "./provider-settings";

type SettingsProps = {
	providers: ProviderOption[];
	credentials: Credential[];
	onCredentialUpsert: (credential: Credential) => void;
	onCredentialRemove: (provider: Credential["provider"]) => void;
	onClose?: () => void;
	embedded?: boolean;
	initialTab?: "models" | "connectors";
	onDirtyChange?: (dirty: boolean) => void;
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

export function OperatorSettings({
	providers,
	credentials,
	onCredentialUpsert,
	onCredentialRemove,
	onClose,
	embedded = false,
	initialTab = "models",
	onDirtyChange,
}: SettingsProps) {
	const t = useTranslations("ai_operator");
	const settingsT = useTranslations("settings.workspace");
	const [tab, setTab] = useState<"models" | "connectors">(initialTab);
	const [connectors, setConnectors] = useState<Connector[]>([]);
	const [connectorForm, setConnectorForm] =
		useState<ConnectorForm>(EMPTY_CONNECTOR);
	const [connectorBaseline, setConnectorBaseline] =
		useState<ConnectorForm>(EMPTY_CONNECTOR);
	const [connectorEditorOpen, setConnectorEditorOpen] = useState(false);
	const [expandedConnector, setExpandedConnector] = useState<string | null>(
		null,
	);
	const [tools, setTools] = useState<Record<string, McpTool[]>>({});
	const [loadingTools, setLoadingTools] = useState<string | null>(null);
	const [busy, setBusy] = useState<string | null>(null);
	const connectorMutationPending = useRef(false);
	const [error, setError] = useState("");
	const [providerDirty, setProviderDirty] = useState(false);
	const connectorDirty = useMemo(
		() => connectorEditorOpen && (
			connectorForm.name !== connectorBaseline.name ||
			connectorForm.url !== connectorBaseline.url ||
			connectorForm.authorization.length > 0 ||
			connectorForm.enabled !== connectorBaseline.enabled
		),
		[connectorBaseline, connectorEditorOpen, connectorForm],
	);

	useEffect(
		() => onDirtyChange?.(providerDirty || connectorDirty),
		[connectorDirty, onDirtyChange, providerDirty],
	);
	useEffect(() => () => onDirtyChange?.(false), [onDirtyChange]);

	function editConnector(form: ConnectorForm) {
		if (busy || connectorMutationPending.current) return;
		if (connectorDirty && !window.confirm(settingsT("unsaved_changes"))) return;
		setConnectorForm(form);
		setConnectorBaseline(form);
		setConnectorEditorOpen(true);
	}

	function closeConnectorEditor(force = false) {
		if ((busy || connectorMutationPending.current) && !force) return;
		setConnectorForm(EMPTY_CONNECTOR);
		setConnectorBaseline(EMPTY_CONNECTOR);
		setConnectorEditorOpen(false);
	}

	function changeTab(next: "models" | "connectors") {
		if (busy || connectorMutationPending.current) return;
		if (next === tab) return;
		if ((providerDirty || connectorDirty) && !window.confirm(settingsT("unsaved_changes"))) return;
		setProviderDirty(false);
		closeConnectorEditor();
		setTab(next);
		setError("");
	}

	function closeSettings() {
		if (busy || connectorMutationPending.current) return;
		if ((providerDirty || connectorDirty) && !window.confirm(settingsT("unsaved_changes"))) return;
		onClose?.();
	}

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
		if (busy || connectorMutationPending.current) return;
		if (!connectorForm.name.trim() || !connectorForm.url.trim()) return;
		connectorMutationPending.current = true;
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
			closeConnectorEditor(true);
		} catch (reason) {
			setError(reason instanceof Error ? reason.message : t("error_generic"));
		} finally {
			connectorMutationPending.current = false;
			setBusy(null);
		}
	}

	async function deleteConnector(id: string) {
		if (busy || connectorMutationPending.current) return;
		connectorMutationPending.current = true;
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
			if (connectorForm.id === id) closeConnectorEditor(true);
		} catch (reason) {
			setError(reason instanceof Error ? reason.message : t("error_generic"));
		} finally {
			connectorMutationPending.current = false;
			setBusy(null);
		}
	}

	return (
		<div className={embedded ? "bg-transparent" : "absolute inset-0 z-20 flex flex-col bg-white dark:bg-[#0f1011]"}>
			{!embedded && <div className="flex h-16 shrink-0 items-center justify-between border-b border-slate-200 px-5 dark:border-white/8">
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
					onClick={closeSettings}
					disabled={Boolean(busy)}
					className="flex h-9 w-9 items-center justify-center rounded-xl text-slate-500 hover:bg-slate-100 dark:hover:bg-white/5"
					aria-label={t("close")}
				>
					<X className="h-4 w-4" />
				</button>
			</div>}

			{!embedded && <div className="flex shrink-0 gap-1 border-b border-slate-200 px-5 pt-3 dark:border-white/8">
				{(["models", "connectors"] as const).map((item) => (
					<button
						key={item}
						onClick={() => changeTab(item)}
						disabled={Boolean(busy)}
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
			</div>}

			<div className={embedded ? "py-1" : "flex-1 overflow-y-auto p-5"}>
				{error && (
					<div
						role="alert"
						className="mb-4 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700 dark:border-red-500/20 dark:bg-red-500/10 dark:text-red-300"
					>
						{error}
					</div>
				)}
				{tab === "models" ? (
					<div className="space-y-4">
						{!embedded && <div>
							<h3 className="text-sm font-semibold text-slate-900 dark:text-white">
								{t("models_title")}
							</h3>
							<p className="mt-1 text-xs leading-5 text-slate-500">
								{t("models_description")}
							</p>
						</div>}
						<ProviderSettings
							providers={providers}
							credentials={credentials}
							onSaved={onCredentialUpsert}
							onDeleted={onCredentialRemove}
							onDirtyChange={setProviderDirty}
						/>
					</div>
				) : (
					<div className={embedded ? "space-y-5" : "mx-auto max-w-xl space-y-5"}>
						{!embedded && <div>
							<h3 className="text-sm font-semibold text-slate-900 dark:text-white">
								{t("connectors_title")}
							</h3>
							<p className="mt-1 text-xs leading-5 text-slate-500">
								{t("connectors_description")}
							</p>
						</div>}
						{!connectorEditorOpen && (
							<button
								type="button"
								onClick={() => editConnector(EMPTY_CONNECTOR)}
								disabled={Boolean(busy)}
								className="flex min-h-10 items-center gap-2 rounded-lg border border-slate-200 px-3 text-xs font-semibold text-slate-700 hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-500 dark:border-white/10 dark:text-slate-200 dark:hover:bg-white/5"
							>
								<Plus className="h-3.5 w-3.5" />{t("add_connector")}
							</button>
						)}
						{connectorEditorOpen && <div
							className="border-y border-slate-200 py-4 dark:border-white/8"
							onKeyDown={(event) => {
								if (event.key !== "Escape" || busy === "connector") return;
								event.preventDefault();
								event.stopPropagation();
								closeConnectorEditor();
							}}
						>
							<div className="mb-3 flex items-center justify-between">
								<span className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">
									{connectorForm.id ? t("edit_connector") : t("add_connector")}
								</span>
							</div>
							<div className="grid gap-3 sm:grid-cols-2">
								<label className="space-y-1.5 text-xs font-medium text-slate-700 dark:text-slate-300">
									<span>{t("connector_name")}</span><input
									aria-label={t("connector_name")}
									className={inputClass()}
									disabled={Boolean(busy)}
									placeholder={t("connector_name")}
									value={connectorForm.name}
									onChange={(event) =>
										setConnectorForm((current) => ({
											...current,
											name: event.target.value,
										}))
									}
									/>
								</label>
								<label className="space-y-1.5 text-xs font-medium text-slate-700 dark:text-slate-300">
									<span>{t("connector_url")}</span><input
									aria-label={t("connector_url")}
									className={inputClass()}
									disabled={Boolean(busy)}
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
								</label>
							</div>
							<label className="mt-3 block space-y-1.5 text-xs font-medium text-slate-700 dark:text-slate-300">
								<span>{connectorForm.id ? t("authorization_keep") : t("authorization_optional")}</span><input
								aria-label={
									connectorForm.id
										? t("authorization_keep")
										: t("authorization_optional")
								}
								className={inputClass()}
								disabled={Boolean(busy)}
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
							</label>
							<div className="mt-3 flex items-center justify-between">
								<label className="flex items-center gap-2 text-xs font-medium text-slate-600 dark:text-slate-400">
									<input
										type="checkbox"
										disabled={Boolean(busy)}
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
								<div className="flex gap-2"><button
									type="button"
									onClick={() => closeConnectorEditor()}
									disabled={Boolean(busy)}
									className="min-h-10 rounded-lg px-3 text-xs font-medium text-slate-600 hover:bg-slate-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-500 dark:text-slate-300 dark:hover:bg-white/5"
								>{t("cancel")}</button><button
									aria-label={t("save_connector")}
									onClick={saveConnector}
									disabled={
										Boolean(busy) ||
										!connectorForm.name.trim() ||
										!connectorForm.url.trim()
									}
									className="flex min-h-10 items-center gap-2 rounded-lg bg-slate-950 px-3 text-xs font-semibold text-white transition hover:bg-indigo-600 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-500 disabled:opacity-40 dark:bg-indigo-500 dark:hover:bg-indigo-400"
								>
									{busy === "connector" ? (
										<Loader2 className="h-3.5 w-3.5 animate-spin" />
									) : connectorForm.id ? (
										<Save className="h-3.5 w-3.5" />
									) : (
										<Plus className="h-3.5 w-3.5" />
									)}
									{t("save")}
								</button></div>
							</div>
						</div>}
						<div className="divide-y divide-slate-200 border-y border-slate-200 dark:divide-white/8 dark:border-white/8">
							{connectors.length === 0 && (
								<div className="py-5 text-sm text-slate-500 dark:text-slate-400">
									{t("connectors_empty")}
								</div>
							)}
							{connectors.map((connector) => (
								<div key={connector.id}>
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
											editConnector({
													id: connector.id,
													name: connector.name,
													url: connector.url,
													authorization: "",
													enabled: connector.enabled,
												})
										}
										disabled={Boolean(busy)}
											className="rounded-lg px-2 py-1 text-xs text-slate-500 hover:bg-slate-100 dark:hover:bg-white/5"
										>
											{t("edit")}
										</button>
										<button
											aria-label={t("delete_connector_named", {
												name: connector.name,
											})}
											onClick={() => deleteConnector(connector.id)}
										disabled={Boolean(busy)}
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
