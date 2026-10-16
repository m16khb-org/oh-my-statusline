// The private tmux server Codex runs in: its config, command runner, and the ANSI → tmux style
// conversion for the two status rows.

import path from "node:path";

/** POSIX shell single-quoting: safe for any path, including spaces and quotes. */
export function shellQuote(text: string): string {
	return `'${text.replaceAll("'", "'\\''")}'`;
}

/** The server's config: a two-row status area fed by `cat` of the rows the collector writes. */
export function tmuxConf(run: string): string {
	const lines = [
		'set -g default-terminal "tmux-256color"',
		'set -as terminal-features ",*:RGB:clipboard"',
		"set -g set-clipboard on",
		"set -g mouse on",
		"set -g history-limit 50000",
		"set -g status 2",
		"set -g status-position bottom",
		"set -g status-interval 2",
		'set -g status-style "bg=default,fg=#737aa2"',
		"set -g allow-rename off",
		"set -g set-titles on",
		'set -g set-titles-string "Codex"',
		"set -g exit-empty on",
	];
	for (const row of [0, 1]) {
		// tmux expands formats inside #(…): a literal `#` in the path must be doubled.
		const file = path.join(run, `row${row}`).replaceAll("#", "##");
		const command = `#(cat ${shellQuote(file)})`.replace(/[\\"$]/g, "\\$&");
		lines.push(`set -g status-format[${row}] "${command}"`);
	}
	return `${lines.join("\n")}\n`;
}

export interface TmuxResult {
	code: number;
	stdout: string;
	stderr: string;
}

/** Run `tmux -S <socket> …args`; a hung tmux is killed after 5 s. */
export async function runTmux(tmux: string, socket: string, args: string[]): Promise<TmuxResult> {
	try {
		const proc = Bun.spawn([tmux, "-S", socket, ...args], { stdin: "ignore", stdout: "pipe", stderr: "pipe", timeout: 5000, killSignal: "SIGKILL" });
		const [stdout, stderr, code] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited]);
		return { code, stdout, stderr };
	} catch (error) {
		return { code: 127, stdout: "", stderr: (error as Error).message };
	}
}

const OSC8 = /\x1b\]8;[^\x07]*(?:\x07|\x1b\\)/g;

/**
 * Convert one ANSI row to tmux style text: hyperlinks are dropped, `#` is doubled (so `#(…)` and
 * `#[…]` in the content stay literal), control characters are removed, and SGR color/bold
 * sequences become `#[fg=#rrggbb,bg=…,bold,default]`.
 */
export function ansiToTmux(text: string): string {
	let out = "";
	for (const part of text.replace(OSC8, "").split(/(\x1b\[[0-9;]*m)/)) {
		if (!part.startsWith("\x1b[")) {
			out += part.replace(/[\x00-\x1f\x7f]/g, "").replaceAll("#", "##");
			continue;
		}
		const nums = part.slice(2, -1).split(";").map((n) => Number(n || 0));
		const styles: string[] = [];
		for (let i = 0; i < nums.length; i++) {
			const n = nums[i];
			if (n === 0) styles.push("default");
			else if (n === 1) styles.push("bold");
			else if ((n === 38 || n === 48) && i + 4 < nums.length && nums[i + 1] === 2) {
				const [r = 0, g = 0, b = 0] = nums.slice(i + 2, i + 5);
				styles.push(`${n === 38 ? "fg" : "bg"}=#${[r, g, b].map((c) => c.toString(16).padStart(2, "0")).join("")}`);
				i += 4;
			} else if ((n === 38 || n === 48) && i + 2 < nums.length && nums[i + 1] === 5) {
				styles.push(`${n === 38 ? "fg" : "bg"}=colour${nums[i + 2]}`);
				i += 2;
			}
		}
		out += `#[${styles.join(",")}]`;
	}
	return out;
}
