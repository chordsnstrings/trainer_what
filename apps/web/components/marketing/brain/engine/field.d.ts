// Declarations for field.js (the client runtime; it imports its own CSS).
import type { MountOptions, ShowcaseApi } from "./types";

export declare function mount(root: HTMLElement, o: MountOptions): Promise<ShowcaseApi>;
