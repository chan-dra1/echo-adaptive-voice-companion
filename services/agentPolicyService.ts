/**
 * agentPolicyService.ts
 *
 * Lightweight governance layer for destructive / privileged tool calls.
 *
 * Default behavior: shows a browser `confirm()` to the user. Apps can
 * override by registering a custom prompter that, e.g., shows a Toast
 * with action buttons. The dynamic-skill subsystem registers a prompter
 * once the SkillApprovalModal is mounted.
 *
 * The "YOLO mode" toggle (localStorage 'echo_yolo_mode' === 'true')
 * short-circuits confirmations — intended for personal-use convenience.
 */

export type ConfirmHandler = (toolName: string, args: any, reason?: string) => Promise<boolean>;

let customHandler: ConfirmHandler | null = null;

export const agentPolicyService = {
    setConfirmHandler(h: ConfirmHandler | null): void {
        customHandler = h;
    },

    isYoloMode(): boolean {
        return localStorage.getItem('echo_yolo_mode') === 'true';
    },

    /**
     * Returns true if the action may proceed.
     */
    async requireConfirmation(toolName: string, args: any, reason?: string): Promise<boolean> {
        if (this.isYoloMode()) return true;
        if (customHandler) return customHandler(toolName, args, reason);

        const summary = typeof args === 'object'
            ? JSON.stringify(args, null, 2).slice(0, 400)
            : String(args);
        const msg = `Echo wants to run "${toolName}".\n${reason ? reason + '\n\n' : ''}Args:\n${summary}\n\nAllow?`;
        try { return window.confirm(msg); } catch { return false; }
    },
};
