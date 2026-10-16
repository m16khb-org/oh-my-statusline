import type { AppearancePort, CachePort, ClockPort } from "../application/ports.ts";
import type { ThemeName } from "../domain/render/cells.ts";
import { type CommandRunner, run } from "./process.ts";

const THEME_TTL_MS = 30_000;

export class AppearanceAdapter implements AppearancePort {
	constructor(
		private readonly cache: CachePort,
		private readonly clock: ClockPort,
		private readonly exec: CommandRunner = run,
		private readonly which: (bin: string) => string | null = Bun.which,
	) {}

	async theme(): Promise<ThemeName> {
		const cached = this.cache.read<ThemeName>("theme");
		if (cached && this.clock.now() >= cached.storedAtMs && this.clock.now() - cached.storedAtMs < THEME_TTL_MS) return cached.value;
		let theme: ThemeName = "dark";
		if (this.which("defaults")) {
			// `defaults` exits non-zero when AppleInterfaceStyle is unset, which is how macOS reports light mode.
			const out = await this.exec(["defaults", "read", "-g", "AppleInterfaceStyle"]);
			theme = out?.trim() === "Dark" ? "dark" : "light";
		}
		this.cache.write("theme", theme);
		return theme;
	}
}
