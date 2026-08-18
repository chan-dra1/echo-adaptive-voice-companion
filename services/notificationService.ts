/**
 * notificationService.ts
 *
 * Unified vibration + notification surface for both the native Capacitor
 * shell (iOS/Android) and the web/PWA build. Native gets real OS-level
 * haptics (@capacitor/haptics) and local notifications
 * (@capacitor/local-notifications, which — unlike the web `Notification`
 * API reminderService used directly before — actually shows in the
 * system tray on a real device and works while the app is backgrounded).
 * Web falls back to `navigator.vibrate()` and the `Notification` API.
 * Every function is a safe no-op if the underlying capability isn't
 * available, so callers never need their own platform checks.
 */

import { Capacitor } from '@capacitor/core';
import { Haptics, ImpactStyle, NotificationType } from '@capacitor/haptics';
import { LocalNotifications } from '@capacitor/local-notifications';

let permissionRequested = false;

/** Short haptic tap — connect/disconnect, sent message, completed a task. */
export async function vibrateTap(): Promise<void> {
    try {
        if (Capacitor.isNativePlatform()) {
            await Haptics.impact({ style: ImpactStyle.Light });
        } else if ('vibrate' in navigator) {
            navigator.vibrate(15);
        }
    } catch { /* haptics unavailable — silently skip */ }
}

/** Stronger buzz for something the user should actually notice — a
 *  reminder firing, a sub-agent finishing, overnight work being ready. */
export async function vibrateAlert(): Promise<void> {
    try {
        if (Capacitor.isNativePlatform()) {
            await Haptics.notification({ type: NotificationType.Success });
        } else if ('vibrate' in navigator) {
            navigator.vibrate([30, 60, 30]);
        }
    } catch { /* haptics unavailable — silently skip */ }
}

/** Ask for notification permission once. Call this from an explicit user
 *  action (a Settings toggle, or the first time something worth notifying
 *  about happens) — never unconditionally at boot, which reads as spammy
 *  and tends to get auto-denied by the OS/browser. */
export async function requestNotificationPermission(): Promise<boolean> {
    try {
        if (Capacitor.isNativePlatform()) {
            const res = await LocalNotifications.requestPermissions();
            return res.display === 'granted';
        }
        if ('Notification' in window) {
            if (Notification.permission === 'granted') return true;
            if (Notification.permission === 'denied') return false;
            const perm = await Notification.requestPermission();
            return perm === 'granted';
        }
    } catch { /* ignore */ }
    return false;
}

export function hasNotificationPermission(): boolean {
    if (Capacitor.isNativePlatform()) {
        // LocalNotifications.checkPermissions() is async; callers that need
        // a definite native answer should await requestNotificationPermission()
        // instead. This sync check is web-only and defaults native to true
        // (native prompts on first requestNotificationPermission() call).
        return true;
    }
    return 'Notification' in window && Notification.permission === 'granted';
}

export interface NotifyOptions {
    title: string;
    body: string;
    /** Also buzz the device — default true. */
    vibrate?: boolean;
}

/** Show a notification (native OS tray on Capacitor, browser Notification
 *  on web) plus an optional haptic buzz. Requests permission on first use
 *  if it hasn't been asked yet this session — silently does nothing if the
 *  user has denied it. */
export async function notify(opts: NotifyOptions): Promise<void> {
    if (opts.vibrate !== false) void vibrateAlert();

    try {
        if (Capacitor.isNativePlatform()) {
            if (!permissionRequested) {
                permissionRequested = true;
                await requestNotificationPermission();
            }
            const perm = await LocalNotifications.checkPermissions();
            if (perm.display !== 'granted') return;
            await LocalNotifications.schedule({
                notifications: [{
                    id: Math.floor(Date.now() % 2147483647),
                    title: opts.title,
                    body: opts.body,
                    schedule: { at: new Date(Date.now() + 50) },
                }],
            });
            return;
        }

        if (!('Notification' in window)) return;
        if (Notification.permission === 'default' && !permissionRequested) {
            permissionRequested = true;
            await requestNotificationPermission();
        }
        if (Notification.permission === 'granted') {
            new Notification(opts.title, { body: opts.body, icon: '/logo192.png' });
        }
    } catch (e) {
        console.warn('[notificationService] notify failed:', e);
    }
}
