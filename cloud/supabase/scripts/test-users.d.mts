export declare const TEST_EMAIL_PATTERN: "oab-e2e+%@example.test";
export declare const INTEGRATION_EMAIL_PATTERN: "oab-test+%@example.test";
export declare const EMAIL_TABLES: readonly ["profiles", "invited_emails", "access_requests"];
export declare function isTestEmail(email: unknown): boolean;
export declare function isIntegrationEmail(email: unknown): boolean;
export declare function testAuthUsers(admin: unknown, match?: (email: unknown) => boolean): Promise<Array<{ id: string; email: string }>>;
export type EmailRows = {
  emailsLike(table: string, pattern: string): Promise<string[]>;
  deleteEmail(table: string, email: string): Promise<void>;
};
export declare function emailRows(env: { url: string; key: string }): EmailRows;
export declare function markHumanChecked(env: { url: string; key: string }, userIds: string[]): Promise<number>;
export declare function humanCheckTestUsers(admin: unknown, env: { url: string; key: string }): Promise<number>;
