// oh-my-statusline for the OpenCode TUI: a two-row powerline status line drawn under the prompt.
//
//   Row 1  [model][effort] [dir] [git] [subagents/shells]  cost · duration · +added −removed vs HEAD
//   Row 2  ctx gauge: gradient bar, used %, tokens/limit
//
// OpenCode loads <install dir>/tui.tsx (a one-line re-export of this file) as a TUI plugin from
// cli.json `plugins`. The plugin collects what the running TUI already knows (model and effort
// variant, location, session cost and age, context window, running subagents and shells), adds the
// working tree state from `git`, which the API does not expose, and hands the snapshot to the
// shared renderer. Data OpenCode has no source for stays out of the snapshot: the 5h/7d/per-model
// plan limits, the PR/MR chip and the prompt-cache hit rate and TTL (see snapshot.ts).
//
// The built-in usage row is turned off in cli.json (`-opencode.prompt.footer`), because it repeats
// this line's cost and context numbers. install.ts writes that entry.

import { Plugin } from "@opencode/plugin/tui";
import type { Context, SlotMap } from "@opencode/plugin/tui/context";
import { For, Show, createEffect, createMemo, createSignal, onCleanup } from "solid-js";
import { GitWatcher, NO_GIT, type GitView } from "./git-watcher.ts";
import { type Options, readOptions } from "./options.ts";
import { nodeRunner } from "./runtime.ts";
import { demoInput, toStatusSnapshot, type StatusInput } from "./snapshot.ts";
import { footerVisible, homeDirectory, homeInput, type Run, sessionDirectory, sessionInput, statusRows, terminalWidth } from "./view.ts";

type FooterInput = SlotMap["prompt.footer"];

/** The git chip's data for one directory, polled at the `interval` option. */
function useGit(directory: () => string | undefined, options: () => Options) {
	const [view, setView] = createSignal<GitView>(NO_GIT);
	const watcher = new GitWatcher({ run: nodeRunner, intervalMs: options().interval, onChange: (next) => setView(next) });
	createEffect(() => void watcher.watch(directory()));
	watcher.start();
	onCleanup(() => watcher.stop());
	return view;
}

/** Seconds-resolution clock, for the session age. */
function useNow() {
	const [now, setNow] = createSignal(Date.now());
	const ticker = setInterval(() => setNow(Date.now()), 1000);
	onCleanup(() => clearInterval(ticker));
	return now;
}

/** One text row: powerline chips and ink-coloured stats on the terminal background. */
function Row(props: { readonly runs: readonly Run[] }) {
	return (
		<text wrapMode="none" flexShrink={0}>
			<For each={props.runs}>{(run) => <span style={{ fg: run.fg, bg: run.bg, bold: run.bold }}>{run.text}</span>}</For>
		</text>
	);
}

/**
 * The rows for one input, re-fitted whenever the data, the options, the theme or the terminal
 * width changes. The width is read from the renderer on every resize event, and polled once a
 * second as a fallback.
 */
function Statusline(props: { readonly context: Context; readonly input: () => StatusInput; readonly options: () => Options }) {
	const renderer = props.context.renderer as unknown as {
		on?: (event: string, listener: () => void) => void;
		off?: (event: string, listener: () => void) => void;
	};
	const [width, setWidth] = createSignal(terminalWidth(props.context.renderer));
	const update = () => {
		const next = terminalWidth(props.context.renderer);
		setWidth((previous) => (previous === next ? previous : next));
	};
	renderer?.on?.("resize", update);
	const poll = setInterval(update, 1000);
	onCleanup(() => {
		renderer?.off?.("resize", update);
		clearInterval(poll);
	});

	const now = useNow();
	const rows = createMemo(() => {
		const options = props.options();
		const input = options.demo ? demoInput(now()) : props.input();
		return statusRows(toStatusSnapshot(input, options, now()), options, width(), now());
	});

	return (
		<Show when={rows().length > 0}>
			<box flexDirection="column" flexShrink={0}>
				<For each={rows()}>{(row) => <Row runs={row} />}</For>
			</box>
		</Show>
	);
}

/** Below the prompt of an open session: two rows. */
function SessionStatusline(props: { readonly context: Context; readonly input: FooterInput }) {
	const options = createMemo(() => readOptions(props.context.options, props.context.themeMode));
	const git = useGit(() => sessionDirectory(props.context, props.input.sessionID), options);
	const input = createMemo(() => {
		const sessionID = props.input.sessionID;
		return sessionID ? sessionInput(props.context, sessionID, git()) : homeInput(props.context, git());
	});
	return (
		<Show when={footerVisible(props.input)}>
			<Statusline context={props.context} input={input} options={options} />
		</Show>
	);
}

/** On the home screen: the same chips, one row. */
function HomeStatusline(props: { readonly context: Context }) {
	const options = createMemo(() => readOptions(props.context.options, props.context.themeMode));
	const git = useGit(() => homeDirectory(props.context), options);
	const input = createMemo(() => homeInput(props.context, git()));
	return (
		<Show when={options().home}>
			<Statusline context={props.context} input={input} options={options} />
		</Show>
	);
}

export default Plugin.define({
	id: "local.statusline",
	setup(context: Context) {
		context.ui.slot({
			prepend: "prompt.footer",
			render: (input: FooterInput) => <SessionStatusline context={context} input={input} />,
		});
		context.ui.slot({
			append: "home.footer.status",
			render: () => <HomeStatusline context={context} />,
		});
	},
});
