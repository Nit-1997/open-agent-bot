export declare const REFUSAL_CODE: "local_stack_only";
export declare const PORT_MIN: 18700;
export declare const PORT_MAX: 18749;
export declare const FORBIDDEN_ENV: readonly string[];
export declare function inPortRange(port: unknown): boolean;
export declare function forbiddenEnvSet(env: Record<string, string | undefined>): string[];
export declare function localDbUrlProblem(raw: string, label: string): string | undefined;
