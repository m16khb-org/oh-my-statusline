// Use case: turn a snapshot into the status rows under the user's configuration.

import type { StatusSnapshot } from "../domain/model/snapshot.ts";
import type { ThemeName } from "../domain/render/cells.ts";
import { renderRows } from "../domain/render/statusline.ts";
import { colorDepth, type Config } from "./config.ts";

export interface RenderOptions {
	config: Config;
	width: number;
	nowMs: number;
	/** The desktop appearance; used when the theme is "auto". */
	appearance: ThemeName;
	env: Record<string, string | undefined>;
	measure?: (text: string) => number;
	minimumWidth?: number;
}

export function renderStatusline(snapshot: StatusSnapshot, options: RenderOptions): string[] {
	const { config } = options;
	return renderRows(snapshot, {
		width: options.width,
		nowMs: options.nowMs,
		theme: config.theme === "auto" ? options.appearance : config.theme,
		glyphs: config.glyphs,
		colors: colorDepth(config, options.env),
		measure: options.measure,
		minimumWidth: options.minimumWidth,
	});
}
