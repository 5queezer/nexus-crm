/** @vitest-environment jsdom */

import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { beforeEach, describe, expect, it, vi } from "vitest";
import messages from "@/messages/en.json";
import { OperatorSettings } from "../operator-settings";
import type { Credential, ProviderOption } from "../types";

const providers: ProviderOption[] = [
	{
		id: "openai",
		label: "OpenAI",
		authMode: "api_key",
		models: [{ id: "gpt-default", label: "GPT default", description: "" }],
	},
	{
		id: "anthropic",
		label: "Anthropic",
		authMode: "api_key",
		models: [{ id: "claude-default", label: "Claude default", description: "" }],
	},
];

const configured: Credential = {
	id: "credential-openai",
	provider: "openai",
	keyHint: "••••1234",
	defaultModel: "gpt-saved",
	status: "configured",
};

function json(body: unknown, status = 200) {
	return Promise.resolve(
		new Response(JSON.stringify(body), {
			status,
			headers: { "Content-Type": "application/json" },
		}),
	);
}

function renderSettings(options?: {
	credentials?: Credential[];
	onDirtyChange?: (dirty: boolean) => void;
	embedded?: boolean;
	initialTab?: "models" | "connectors";
	onClose?: () => void;
}) {
	return render(
		<NextIntlClientProvider locale="en" messages={messages}>
			<OperatorSettings
				embedded={options?.embedded ?? true}
				initialTab={options?.initialTab ?? "models"}
				onClose={options?.onClose}
				providers={providers}
				credentials={options?.credentials ?? [configured]}
				onCredentialUpsert={vi.fn()}
				onCredentialRemove={vi.fn()}
				onDirtyChange={options?.onDirtyChange}
			/>
		</NextIntlClientProvider>,
	);
}

describe("OperatorSettings provider editor", () => {
	beforeEach(() => {
		vi.restoreAllMocks();
	});

	it("requires confirmation before deleting the stored provider credential", async () => {
		const confirm = vi.spyOn(window, "confirm").mockReturnValueOnce(false).mockReturnValueOnce(true);
		const requests: string[] = [];
		vi.spyOn(globalThis, "fetch").mockImplementation((input, init) => {
			requests.push(`${init?.method} ${String(input)}`);
			return Promise.resolve(new Response(null, { status: 204 }));
		});
		const user = userEvent.setup();
		renderSettings();
		await user.click(screen.getByRole("button", { name: "Manage OpenAI" }));
		await user.click(screen.getByRole("button", { name: "Remove" }));
		expect(requests).toEqual([]);
		expect(screen.getByLabelText("API key for OpenAI")).toBeTruthy();
		expect(confirm).toHaveBeenLastCalledWith("Remove the stored OpenAI credential from Nexus? This does not revoke your API key at the provider.");
		await user.click(screen.getByRole("button", { name: "Remove" }));
		await waitFor(() => expect(screen.queryByLabelText("API key for OpenAI")).toBeNull());
		expect(requests).toEqual(["DELETE /api/agent/credentials?provider=openai"]);
	});

	it("renders compact provider summaries and only one editor below the active row", async () => {
		const user = userEvent.setup();
		renderSettings();

		expect(screen.getByText("Configured · not verified · gpt-saved · ••••1234")).toBeTruthy();
		expect(screen.queryByLabelText("API key for OpenAI")).toBeNull();

		await user.click(screen.getByRole("button", { name: "Manage OpenAI" }));
		expect(screen.getByLabelText("API key for OpenAI")).toBeTruthy();
		expect(document.activeElement).toBe(screen.getByRole("combobox", { name: "Model for OpenAI" }));
		expect(screen.queryByLabelText("API key for Anthropic")).toBeNull();

		await user.click(screen.getByRole("button", { name: "Connect Anthropic" }));
		expect(screen.queryByLabelText("API key for OpenAI")).toBeNull();
		expect(screen.getByLabelText("API key for Anthropic")).toBeTruthy();
	});

	it("guards dirty provider switching, discards on cancel, and restores opener focus", async () => {
		const onDirtyChange = vi.fn();
		const confirm = vi.spyOn(window, "confirm").mockReturnValueOnce(false).mockReturnValueOnce(true);
		const user = userEvent.setup();
		renderSettings({ onDirtyChange });

		const manage = screen.getByRole("button", { name: "Manage OpenAI" });
		await user.click(manage);
		await user.type(screen.getByLabelText("API key for OpenAI"), "replacement-secret");
		await waitFor(() => expect(onDirtyChange).toHaveBeenLastCalledWith(true));

		await user.click(screen.getByRole("button", { name: "Connect Anthropic" }));
		expect(confirm).toHaveBeenCalledTimes(1);
		expect(screen.getByLabelText("API key for OpenAI")).toBeTruthy();

		await user.click(screen.getByRole("button", { name: "Connect Anthropic" }));
		expect(screen.getByLabelText("API key for Anthropic")).toBeTruthy();
		expect(screen.queryByDisplayValue("replacement-secret")).toBeNull();

		const connect = screen.getByRole("button", { name: "Connect Anthropic" });
		await user.click(screen.getByRole("button", { name: "Cancel" }));
		expect(screen.queryByLabelText("API key for Anthropic")).toBeNull();
		expect(document.activeElement).toBe(connect);
		expect(onDirtyChange).toHaveBeenLastCalledWith(false);

		await user.click(connect);
		await user.type(screen.getByLabelText("API key for Anthropic"), "discard-on-escape");
		await user.keyboard("{Escape}");
		expect(screen.queryByDisplayValue("discard-on-escape")).toBeNull();
		expect(document.activeElement).toBe(connect);
	});

	it("keeps a failed discovery draft, offers retry and manual model entry, then saves explicitly", async () => {
		let discoveries = 0;
		let savedBody: Record<string, unknown> | undefined;
		vi.spyOn(globalThis, "fetch").mockImplementation((input, init) => {
			const url = String(input);
			if (url.endsWith("/api/agent/provider-models")) {
				discoveries += 1;
				return discoveries === 1
					? json({ error: "Could not fetch models" }, 502)
					: json({ models: [{ id: "gpt-live", label: "GPT live", description: "" }] });
			}
			if (url.endsWith("/api/agent/credentials") && init?.method === "PUT") {
				savedBody = JSON.parse(String(init.body));
				return json({ credential: { ...configured, defaultModel: "custom-model" } });
			}
			return json({ error: "not found" }, 404);
		});
		const user = userEvent.setup();
		renderSettings({ credentials: [] });

		await user.click(screen.getByRole("button", { name: "Connect OpenAI" }));
		const key = screen.getByLabelText("API key for OpenAI");
		await user.type(key, "new-secret-key");
		await user.click(screen.getByRole("button", { name: "Check and discover models" }));
		expect((await screen.findByRole("alert")).textContent).toContain("Could not fetch models");
		expect((key as HTMLInputElement).value).toBe("new-secret-key");
		expect(screen.getByRole("button", { name: "Retry model discovery" })).toBeTruthy();

		await user.click(screen.getByRole("button", { name: "Retry model discovery" }));
		expect(await screen.findByRole("option", { name: "GPT live" })).toBeTruthy();
		expect(screen.getByText("Models loaded. Review your choice, then save.")).toBeTruthy();

		await user.selectOptions(screen.getByRole("combobox", { name: "Model for OpenAI" }), "__manual__");
		const manualModel = screen.getByRole("textbox", { name: "Manual model ID for OpenAI" });
		await user.clear(manualModel);
		await user.type(manualModel, "custom-model");
		await user.click(screen.getByRole("button", { name: "Save" }));
		await waitFor(() => expect(savedBody).toEqual({ provider: "openai", model: "custom-model", apiKey: "new-secret-key" }));
		expect(screen.queryByLabelText("API key for OpenAI")).toBeNull();
		const savedOpener = screen.getByRole("button", { name: "Connect OpenAI" });
		expect((savedOpener as HTMLButtonElement).disabled).toBe(false);
		await user.click(savedOpener);
		expect(screen.getByLabelText("API key for OpenAI")).toBeTruthy();
	});

	it("allows an explicitly unverified manual model after discovery fails", async () => {
		let savedBody: Record<string, unknown> | undefined;
		vi.spyOn(globalThis, "fetch").mockImplementation((input, init) => {
			const url = String(input);
			if (url.endsWith("/api/agent/provider-models")) return json({ error: "No model-list permission" }, 502);
			if (url.endsWith("/api/agent/credentials") && init?.method === "PUT") {
				savedBody = JSON.parse(String(init.body));
				return json({ credential: { ...configured, defaultModel: "manual-only" } });
			}
			return json({ error: "not found" }, 404);
		});
		const user = userEvent.setup();
		renderSettings({ credentials: [] });

		await user.click(screen.getByRole("button", { name: "Connect OpenAI" }));
		await user.type(screen.getByLabelText("API key for OpenAI"), "model-less-key");
		await user.click(screen.getByRole("button", { name: "Check and discover models" }));
		await screen.findByText("No model-list permission");
		await user.selectOptions(screen.getByRole("combobox", { name: "Model for OpenAI" }), "__manual__");
		expect(screen.getByText(/could not be verified/)).toBeTruthy();
		await user.type(screen.getByRole("textbox", { name: "Manual model ID for OpenAI" }), "manual-only");
		await user.click(screen.getByRole("button", { name: "Save" }));
		await waitFor(() => expect(savedBody).toEqual({ provider: "openai", model: "manual-only", apiKey: "model-less-key" }));
	});

	it("shows the prior selection as a manual draft when a new key returns no models", async () => {
		let discoveries = 0;
		let savedBody: Record<string, unknown> | undefined;
		vi.spyOn(globalThis, "fetch").mockImplementation((input, init) => {
			const url = String(input);
			if (url.endsWith("/api/agent/provider-models")) {
				discoveries += 1;
				return json({ models: discoveries === 1 ? [{ id: "key-a-model", label: "Key A model", description: "" }] : [] });
			}
			if (url.endsWith("/api/agent/credentials") && init?.method === "PUT") {
				savedBody = JSON.parse(String(init.body));
				return json({ credential: { ...configured, defaultModel: "key-a-model" } });
			}
			return json({ error: "not found" }, 404);
		});
		const user = userEvent.setup();
		renderSettings({ credentials: [] });

		await user.click(screen.getByRole("button", { name: "Connect OpenAI" }));
		const key = screen.getByLabelText("API key for OpenAI");
		await user.type(key, "key-aaaa-1234");
		await user.click(screen.getByRole("button", { name: "Check and discover models" }));
		await user.selectOptions(await screen.findByRole("combobox", { name: "Model for OpenAI" }), "key-a-model");

		await user.clear(key);
		await user.type(key, "key-bbbb-1234");
		await user.click(screen.getByRole("button", { name: "Check and discover models" }));
		await waitFor(() => expect(screen.queryByRole("option", { name: "Key A model" })).toBeNull());
		const manual = screen.getByRole("textbox", { name: "Manual model ID for OpenAI" }) as HTMLInputElement;
		expect(manual.value).toBe("key-a-model");

		await user.click(screen.getByRole("button", { name: "Save" }));
		await waitFor(() => expect(savedBody).toEqual({ provider: "openai", model: "key-a-model", apiKey: "key-bbbb-1234" }));
	});

	it("locks every connector mutation control while a save is pending", async () => {
		let resolveSave!: (response: Response) => void;
		const pendingSave = new Promise<Response>((resolve) => { resolveSave = resolve; });
		let mutationCount = 0;
		const onClose = vi.fn();
		vi.spyOn(globalThis, "fetch").mockImplementation((input, init) => {
			const url = String(input);
			if (url.endsWith("/api/agent/connectors") && !init?.method) return json({ connectors: [
				{ id: "connector-1", name: "First", url: "https://first.example/mcp", enabled: true, hasAuthorization: false },
				{ id: "connector-2", name: "Second", url: "https://second.example/mcp", enabled: true, hasAuthorization: false },
			] });
			if (init?.method === "PUT" || init?.method === "DELETE" || init?.method === "POST") {
				mutationCount += 1;
				return pendingSave;
			}
			return json({ error: "not found" }, 404);
		});
		const user = userEvent.setup();
		renderSettings({ embedded: false, initialTab: "connectors", onClose });

		await user.click(await screen.findByRole("button", { name: "Edit First" }));
		await user.clear(screen.getByRole("textbox", { name: "Connector name" }));
		await user.type(screen.getByRole("textbox", { name: "Connector name" }), "Updated First");
		await user.click(screen.getByRole("button", { name: "Save connector" }));

		expect(mutationCount).toBe(1);
		expect((screen.getByRole("textbox", { name: "Connector name" }) as HTMLInputElement).disabled).toBe(true);
		expect((screen.getByRole("button", { name: "Cancel" }) as HTMLButtonElement).disabled).toBe(true);
		expect((screen.getByRole("button", { name: "Edit Second" }) as HTMLButtonElement).disabled).toBe(true);
		expect((screen.getByRole("button", { name: "Delete Second" }) as HTMLButtonElement).disabled).toBe(true);
		expect((screen.getByRole("button", { name: "AI models" }) as HTMLButtonElement).disabled).toBe(true);
		expect((screen.getByRole("button", { name: "Close" }) as HTMLButtonElement).disabled).toBe(true);

		await user.click(screen.getByRole("button", { name: "Edit Second" }));
		await user.click(screen.getByRole("button", { name: "Delete Second" }));
		await user.click(screen.getByRole("button", { name: "Close" }));
		expect(mutationCount).toBe(1);
		expect(onClose).not.toHaveBeenCalled();

		resolveSave(new Response(JSON.stringify({ connector: { id: "connector-1", name: "Updated First", url: "https://first.example/mcp", enabled: true, hasAuthorization: false } }), { status: 200, headers: { "content-type": "application/json" } }));
		await waitFor(() => expect(screen.queryByRole("textbox", { name: "Connector name" })).toBeNull());
		expect((screen.getByRole("button", { name: "Edit Second" }) as HTMLButtonElement).disabled).toBe(false);
	});
});
