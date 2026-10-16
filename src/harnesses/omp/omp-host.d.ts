// The omp host modules main.ts imports at runtime, declared to the extent it uses them.
// omp resolves these specifiers for extensions; they are not dependencies of this repository.

declare module "@oh-my-pi/pi-coding-agent/config/registry" {
	export function lookup(id: string): { override(scope: unknown, value: unknown): void } | undefined;
}

declare module "@oh-my-pi/pi-ai" {
	export function serviceTierFamily(model: { id: string; provider: string; api?: string }): string | undefined;
}

declare module "@oh-my-pi/pi-coding-agent/registry/agent-registry" {
	export const AgentRegistry: { global(): { list(): { kind: string; status: string }[] } };
}
