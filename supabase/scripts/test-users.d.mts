export declare const TEST_EMAIL_PATTERN: "oab-e2e+%@example.test";
export declare function isTestEmail(email: unknown): boolean;
export declare function testAuthUsers(admin: unknown): Promise<Array<{ id: string; email: string }>>;
