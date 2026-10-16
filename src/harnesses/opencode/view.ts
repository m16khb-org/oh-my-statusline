// The TUI-facing half of the adapter, as plain functions: read what the TUI knows (called inside
// a Solid memo, so every read is tracked), and turn a snapshot into styled text runs. tui.tsx only
// wires these to reactivity and draws the runs.

import { rgbToHex } from "../../domain/model/values.ts";
import type { StatusSnapshot } from "../../domain/model/snapshot.ts";
import { renderCells } from "../../domain/render/statusline.ts";
import type { Context } from "@opencode/plugin/tui/context";
import type { AmbientReading } from "../../infrastructure/ambient.ts";
import type { GitView } from "./git-watcher.ts";
import type { Options } from "./options.ts";
import { textWidth } from "./runtime.ts";
import { contextUsage, type ModelLike, type StatusInput } from "./snapshot.ts";

/** The part of the plugin context the readers use. */
export type TuiContext = Pick<Context, "data" | "ui" | "location">;

interface ModelRef {
	id: string;
	providerID: string;
	variant?: string;
}

/** A catalogue model: what contextUsage needs, plus the display name and family. */
interface ModelEntry extends ModelLike {
	name?: string;
	family?: string;
}

/** The model chip's data: the catalogue's display name without a trailing "(…)", and its family. */
function modelFor(ref: ModelRef | undefined, models: readonly ModelEntry[]): StatusInput["model"] {
	if (!ref) return undefined;
	const info = models.find((candidate) => candidate.providerID === ref.providerID && (candidate.id === ref.id || candidate.modelID === ref.id));
	const name = (info?.name ?? ref.id).replace(/\s*\([^)]*\)$/, "");
	return name ? { name, family: info?.family ?? ref.id, effort: ref.variant } : undefined;
}

/** The model the prompt would use next, as a reference. */
function currentModel(context: TuiContext): ModelRef | undefined {
	const current = context.ui.model.current();
	return current ? { id: current.modelID, providerID: current.providerID, variant: current.variant } : undefined;
}

/** The prompt footer shows the line only for an open session, and not while the prompt is in shell mode. */
export function footerVisible(input: { readonly mode: string; readonly sessionID?: string }): boolean {
	return input.mode === "normal" && !!input.sessionID;
}

/** The directory a session lives in, which the git watcher follows. */
export function sessionDirectory(context: TuiContext, sessionID: string | undefined): string | undefined {
	const session = sessionID ? context.data.session.get(sessionID) : undefined;
	return (session?.location ?? context.location ?? context.data.location.default())?.directory;
}

/** The directory of the home screen. */
export function homeDirectory(context: TuiContext): string | undefined {
	return (context.location ?? context.data.location.default())?.directory;
}

/** The session view: everything the line can show while a session is open. */
export function sessionInput(context: TuiContext, sessionID: string, git: GitView, ambient?: AmbientReading): StatusInput {
	const { data } = context;
	const session = data.session.get(sessionID);
	const location = session?.location ?? context.location ?? data.location.default();
	const models = (location ? data.location.model.list(location) : undefined) ?? [];

	// The session's own model, with the variant the prompt would use for the next message.
	const current = context.ui.model.current();
	const own = session?.model;
	const ref: ModelRef | undefined = own
		? { id: own.id, providerID: own.providerID, variant: own.variant ?? (current && current.modelID === own.id ? current.variant : undefined) }
		: currentModel(context);

	// `family()` is every session under the same root (the root, its children and their siblings), so
	// in a child session the count also takes in sibling subagents and the parent. A precise count
	// would need the session's own children, which the data store does not list.
	const subagents = data.session.family(sessionID).filter((child) => child !== sessionID && data.session.status(child) === "running").length;
	// Shells are matched to the session that started them.
	const shells = location ? data.shell.list(location).filter((shell) => shell.metadata?.sessionID === sessionID && shell.status === "running").length : 0;

	return {
		model: modelFor(ref, models),
		directory: location?.directory ?? "",
		subpath: session?.subpath,
		branch: location ? data.location.vcs.info(location)?.branch?.current : undefined,
		git,
		counts: { subagents, shells },
		costUsd: data.session.cost(sessionID),
		createdMs: session?.time?.created,
		context: contextUsage(data.session.message.list(sessionID), models),
		...ambient,
	};
}

/** The home view: the same chips, without a session to describe. */
export function homeInput(context: TuiContext, git: GitView, ambient?: AmbientReading): StatusInput {
	const { data } = context;
	const location = context.location ?? data.location.default();
	const models = (location ? data.location.model.list(location) : undefined) ?? [];
	return {
		model: modelFor(currentModel(context), models),
		directory: location?.directory ?? "",
		branch: location ? data.location.vcs.info(location)?.branch?.current : undefined,
		git,
		costUsd: 0,
		...ambient,
	};
}

/** Terminal columns, from the renderer; 80 until it reports a size. */
export function terminalWidth(renderer: unknown): number {
	const width = typeof renderer === "object" && renderer !== null && "width" in renderer ? renderer.width : undefined;
	return typeof width === "number" && width > 0 ? Math.floor(width) : 80;
}

/** One run of text in one style, as the TUI's `<span style>` takes it (colors as #rrggbb). */
export interface Run {
	text: string;
	fg?: string;
	bg?: string;
	bold?: boolean;
}

const measure = textWidth();

/**
 * The rows for a terminal `width` columns wide. Nothing is drawn below `minimumWidth`; otherwise
 * the rows fit the width minus 4 columns of padding and `reserve` columns for the text the TUI
 * draws on the same row.
 */
export function statusRows(snapshot: StatusSnapshot, options: Options, width: number, nowMs: number): Run[][] {
	if (width < options.minimumWidth) return [];
	const rows = renderCells(snapshot, {
		width: Math.max(0, width - 4 - options.reserve),
		nowMs,
		theme: options.theme,
		glyphs: options.glyphs,
		colors: 24,
		measure,
		// The minimum applies to the terminal, checked above, not to the space left after the reserve.
		minimumWidth: 0,
	});
	return rows.map((row) =>
		row.map((cell) => ({
			text: cell.text,
			fg: cell.fg && rgbToHex(cell.fg),
			bg: cell.bg && rgbToHex(cell.bg),
			bold: cell.bold,
		})),
	);
}
