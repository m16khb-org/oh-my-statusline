// A value fetched in the background, for long-lived harness processes (omp, OpenCode).

import type { ClockPort } from "./ports.ts";

/**
 * One fetch at a time, per key. It refetches when the value is older than `maxAgeMs`, or once
 * `invalidate()` has been called and the last fetch is `minGapMs` old, so bursts of events
 * (a run of tool calls) collapse into one fetch. A rejected fetch keeps the last value.
 */
export class Poller<T> {
	value: T | undefined;
	#key: string | undefined;
	#at = 0;
	#busy = false;
	#stale = false;

	constructor(
		readonly clock: ClockPort,
		readonly maxAgeMs: number,
		readonly minGapMs: number,
	) {}

	invalidate(): void {
		this.#stale = true;
	}

	/** Start a fetch when one is due; `onUpdate` runs after every fetch settles. */
	poll(key: string, fetch: () => Promise<T | undefined>, onUpdate: () => void): void {
		if (key !== this.#key) {
			this.#key = key;
			this.#at = 0;
			this.value = undefined;
		}
		const age = this.clock.now() - this.#at;
		if (this.#busy || (age < this.maxAgeMs && !(this.#stale && age >= this.minGapMs))) return;
		this.#busy = true;
		this.#stale = false;
		fetch()
			.then(
				(value) => {
					if (key !== this.#key) return;
					this.#at = this.clock.now();
					this.value = value;
				},
				() => {
					if (key === this.#key) this.#at = this.clock.now();
				},
			)
			.finally(() => {
				// A key that changed mid-fetch keeps #at = 0, so its first fetch starts on the next poll.
				this.#busy = false;
				onUpdate();
			});
	}
}
