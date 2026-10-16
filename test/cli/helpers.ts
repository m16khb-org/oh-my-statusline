// Fixtures for the installer CLI tests: a throwaway HOME with a stub tmux and Codex, fake installs
// of the four standalone projects exactly as their own install scripts leave them, and a hash
// snapshot of a directory tree. Nothing here reads or writes the real home.

import { createHash } from "node:crypto";
import { chmodSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

export const ROOT = path.resolve(import.meta.dir, "..", "..");

export interface World {
	root: string;
	home: string;
	/** Stub tmux and the "official" Codex live here; it is first on PATH. */
	stubs: string;
	codex: string;
	env: Record<string, string>;
	bin: string;
	claude: string;
	agent: string;
	opencode: string;
	data: string;
}

const worlds: string[] = [];

export function cleanWorlds(): void {
	for (const dir of worlds.splice(0)) rmSync(dir, { recursive: true, force: true });
}

export function script(file: string, body: string): void {
	mkdirSync(path.dirname(file), { recursive: true });
	writeFileSync(file, `#!/bin/sh\n${body}`);
	chmodSync(file, 0o755);
}

/** A temp HOME whose environment is HOME and a PATH of the stubs plus the system tools. */
export function makeWorld(): World {
	const root = mkdtempSync(path.join(tmpdir(), "oms-cli-"));
	worlds.push(root);
	const home = path.join(root, "home");
	const stubs = path.join(root, "stubs");
	mkdirSync(home, { recursive: true });
	const codex = path.join(stubs, "official-codex");
	script(codex, "exit 0\n");
	script(path.join(stubs, "tmux"), "exit 0\n");
	return {
		root,
		home,
		stubs,
		codex,
		// bun would otherwise keep its transpiler cache under $HOME, which the snapshots would see.
		env: { HOME: home, PATH: `${stubs}:/usr/bin:/bin`, BUN_RUNTIME_TRANSPILER_CACHE_PATH: "0" },
		bin: path.join(home, ".local", "bin"),
		claude: path.join(home, ".claude"),
		agent: path.join(home, ".omp", "agent"),
		opencode: path.join(home, ".config", "opencode"),
		data: path.join(home, ".local", "share"),
	};
}

export interface Run {
	code: number;
	out: string;
	err: string;
}

/** `bun src/cli/<script>.ts args` with the world's environment and no terminal on stdin. */
export function runCli(world: World, script: "install" | "uninstall", args: string[]): Run {
	const proc = Bun.spawnSync([process.execPath, path.join(ROOT, "src", "cli", `${script}.ts`), ...args], {
		env: world.env,
		stdin: "ignore",
		stdout: "pipe",
		stderr: "pipe",
	});
	return { code: proc.exitCode ?? -1, out: proc.stdout.toString(), err: proc.stderr.toString() };
}

/** Every regular file below `dir` (relative path → sha256), or the single file's hash; symlinks are followed. */
export function snapshot(dir: string): Record<string, string> {
	const out: Record<string, string> = {};
	const walk = (rel: string) => {
		for (const entry of readdirSync(path.join(dir, rel), { withFileTypes: true })) {
			const child = path.join(rel, entry.name);
			if (entry.isDirectory()) walk(child);
			else out[child] = createHash("sha256").update(readFileSync(path.join(dir, child))).digest("hex");
		}
	};
	walk("");
	return out;
}

/** The part of `after` that is not in `before` or differs: what a run added or changed. */
export function changes(before: Record<string, string>, after: Record<string, string>): string[] {
	return Object.keys(after).filter((file) => before[file] !== after[file]);
}

/** Files of `before` that are missing or different in `after`. */
export function damaged(before: Record<string, string>, after: Record<string, string>): string[] {
	return Object.keys(before).filter((file) => before[file] !== after[file]);
}

export const json = (value: unknown): string => `${JSON.stringify(value, null, 2)}\n`;
export const readJson = <T = Record<string, unknown>>(file: string): T => JSON.parse(readFileSync(file, "utf8")) as T;

export function write(file: string, body: string): void {
	mkdirSync(path.dirname(file), { recursive: true });
	writeFileSync(file, body);
}

// ---- the user's own files, as they were before any status line --------------------------------

export const FOOTER = "-opencode.prompt.footer";
export const USER_STATUS = { type: "command", command: "~/.claude/my-statusline.sh" };

export function seedUser(world: World): void {
	write(path.join(world.claude, "settings.json"), json({ model: "opus", statusLine: USER_STATUS, permissions: { allow: ["Bash(ls)"] } }));
	write(path.join(world.opencode, "cli.json"), json({ theme: "tokyonight", plugins: ["./herdr", { package: "other", options: { a: 1 } }] }));
	write(path.join(world.agent, "extensions", "other.ts"), "export default () => {};\n");
	write(path.join(world.bin, "my-tool"), "#!/bin/sh\necho mine\n");
}

// ---- the four standalone projects, as their install scripts leave them ----------------------

/** claude-code-statusline's install.sh: its directory, jq-written saved entries, and settings.json switched to it. */
export function legacyClaude(world: World, glyphs: "plain" | "powerline" = "powerline"): void {
	const dir = path.join(world.claude, "claude-code-statusline");
	const settingsFile = path.join(world.claude, "settings.json");
	const settings = readJson(settingsFile);
	write(path.join(dir, "statusline.sh"), "#!/usr/bin/env bash\n# claude-code-statusline\n");
	chmodSync(path.join(dir, "statusline.sh"), 0o755);
	// jq prints `null` or the pretty-printed object.
	write(path.join(dir, "previous-statusline.json"), json(settings.statusLine ?? null));
	write(path.join(dir, "previous-subagent-statusline.json"), json(settings.subagentStatusLine ?? null));
	write(`${settingsFile}.bak-20260101-000000`, readFileSync(settingsFile, "utf8"));
	const command = `${glyphs === "plain" ? "STATUSLINE_GLYPHS=plain " : ""}bash "${dir}/statusline.sh"`;
	settings.statusLine = { type: "command", command, refreshInterval: 30 };
	settings.subagentStatusLine = { type: "command", command: `${command} --subagents` };
	write(settingsFile, json(settings));
}

/** codex-statusline's install.py: install.json, its sources, and the launchers it lists (with `codex` when wrapped). */
export function legacyCodex(world: World, opts: { wrap?: boolean; glyphs?: "plain" | "powerline" } = {}): { dir: string; launchers: string[] } {
	const dir = path.join(world.data, "codex-statusline");
	const sha = (text: string) => createHash("sha256").update(text).digest("hex");
	for (const name of ["statusline.py", "renderer.sh", "LICENSE"]) write(path.join(dir, name), `# codex-statusline ${name}\n`);
	const launcher = `#!/bin/sh\n# codex-statusline launcher\n[ -n "$HERDR_PANE_ID" ] && export HERDR_AGENT="\${HERDR_AGENT:-codex}"\nexec /usr/bin/python3 ${dir}/statusline.py "$@"\n`;
	const plain = `#!/bin/sh\n# codex-statusline launcher\nexec ${world.codex} "$@"\n`;
	const files: Record<string, string> = { [path.join(world.bin, "codex-statusline")]: launcher, [path.join(world.bin, "codex-plain")]: plain };
	if (opts.wrap) files[path.join(world.bin, "codex")] = launcher;
	const launchers: Record<string, string> = {};
	for (const [file, body] of Object.entries(files)) {
		script(file, body.slice("#!/bin/sh\n".length));
		launchers[file] = sha(body);
	}
	write(path.join(dir, "install.json"), `${JSON.stringify({ codex: world.codex, glyphs: opts.glyphs ?? "powerline", launchers }, null, 2)}\n`);
	return { dir, launchers: Object.keys(files) };
}

/** omp-statusline's install.sh (marker) or a hand copy (no marker): index.ts, render.ts, config.json. */
export function legacyOmp(world: World, opts: { marker?: boolean; glyphs?: "plain" | "powerline" } = {}): string {
	const dir = path.join(world.agent, "extensions", "omp-statusline");
	write(path.join(dir, "index.ts"), "// omp-statusline: a two-row powerline status line for omp (oh-my-pi), drawn below the prompt.\nexport default () => {};\n");
	write(path.join(dir, "render.ts"), "// omp-statusline renderer: a two-row powerline status line for omp (oh-my-pi).\n");
	write(path.join(dir, "config.json"), `{ "glyphs": "${opts.glyphs ?? "powerline"}" }\n`);
	if (opts.marker !== false) write(path.join(dir, ".omp-statusline"), "installed from /somewhere/omp-statusline\n");
	return dir;
}

/** opencode-statusline's install.sh: its directory, the saved plugins list and file, and cli.json switched to it. */
export function legacyOpencode(world: World, options: Record<string, unknown> = { glyphs: "powerline" }): string {
	const dir = path.join(world.opencode, "statusline");
	const cliFile = path.join(world.opencode, "cli.json");
	const before = readFileSync(cliFile, "utf8");
	const cli = JSON.parse(before) as Record<string, unknown>;
	write(path.join(dir, "tui.tsx"), "// opencode-statusline\n");
	write(path.join(dir, "render.ts"), "// opencode-statusline renderer\n");
	write(path.join(dir, ".opencode-statusline"), "installed from /somewhere/opencode-statusline\n");
	write(path.join(dir, "cli.json.bak"), before);
	// jq -c '{ had: has("plugins"), plugins: (.plugins // []) }'
	const saved = (cli.plugins as unknown[] | undefined) ?? [];
	write(path.join(dir, "previous-plugins.json"), `${JSON.stringify({ had: "plugins" in cli, plugins: saved })}\n`);
	const plugins: unknown[] = [...saved];
	if (!plugins.includes(FOOTER)) plugins.push(FOOTER);
	plugins.push({ package: "./statusline", options });
	write(cliFile, json({ ...cli, plugins }));
	return dir;
}

/** All four legacy installs on top of `seedUser`. */
export function legacyAll(world: World): void {
	legacyClaude(world, "plain");
	legacyCodex(world, { wrap: true, glyphs: "plain" });
	legacyOmp(world, { glyphs: "plain" });
	legacyOpencode(world, { glyphs: "plain", home: false });
}
