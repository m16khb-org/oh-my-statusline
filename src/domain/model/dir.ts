import type { DirInfo } from "./snapshot.ts";

function basename(path: string): string {
	const trimmed = path.replace(/\/+$/, "");
	return trimmed.slice(trimmed.lastIndexOf("/") + 1);
}

/**
 * The directory chip's data from paths: the repository name (the harness's own repository name
 * when it knows one, else the main checkout's folder), the path below the checkout root, and a
 * linked worktree's folder name. Outside a repository it is the working directory's folder.
 */
export function toDirInfo(paths: { cwd: string; top?: string; main?: string; repoName?: string }): DirInfo {
	const cwd = paths.cwd.replace(/\/+$/, "") || "/";
	const top = paths.top?.replace(/\/+$/, "") ?? "";
	const main = paths.main?.replace(/\/+$/, "") || top;
	const root = top || cwd;
	let name = paths.repoName || basename(main) || basename(root);
	let relative = "";
	if (cwd !== root) {
		if (cwd.startsWith(`${root}/`)) relative = cwd.slice(root.length + 1);
		else name = basename(cwd);
	}
	const worktree = top && top !== main ? basename(top) : null;
	return { name: name || "/", relative, worktree };
}
