import { homedir } from "node:os";
import { basename, join } from "node:path";
import type { Session, WebContents } from "electron";
import { describeUrl } from "./firewall.ts";
import type { Log } from "./logger.ts";
import { subframeDecision } from "./navigation.ts";

export const APP_PARTITION = "persist:open-agent";

const originOf = (url: string | undefined) => {
  if (!url) return undefined;
  try {
    const o = new URL(url).origin;
    return o === "null" ? undefined : o;
  } catch {
    return undefined;
  }
};

export function permissionDecision(permission: string, requestingUrl: string | undefined, appOrigin: string | undefined): boolean {
  return permission === "clipboard-sanitized-write" && appOrigin !== undefined && originOf(requestingUrl) === appOrigin;
}

export function downloadDecision(o: { partition: string; url: string; appOrigin: string | undefined }): "save" | "cancel" {
  if (o.partition !== APP_PARTITION || !o.appOrigin) return "cancel";
  let u: URL;
  try {
    u = new URL(o.url);
  } catch {
    return "cancel";
  }
  return (u.protocol === "http:" || u.protocol === "https:") && u.origin === o.appOrigin ? "save" : "cancel";
}

const safeFileName = (name: string) =>
  [...basename(name)]
    .map((c) => ((c.codePointAt(0) ?? 0) <= 0x1f || c === "\u007f" || c === ":" ? "_" : c))
    .join("")
    .slice(0, 200) || "download";

export function hardenSession(ses: Session, o: { name: string; appOrigin: () => string | undefined; savePath?: string; log: Log }): void {
  const { log, name } = o;
  ses.setPermissionRequestHandler((_wc, permission, callback, details) => {
    const ok = permissionDecision(permission, details.requestingUrl, o.appOrigin());
    if (!ok) log.warn(`[permission] deny ${permission} ${name}`);
    callback(ok);
  });
  ses.setPermissionCheckHandler((_wc, permission, requestingOrigin) => permissionDecision(permission, requestingOrigin, o.appOrigin()));
  ses.setDevicePermissionHandler((details) => {
    log.warn(`[permission] deny device ${details.deviceType} ${name}`);
    return false;
  });
  ses.setDisplayMediaRequestHandler((_request, callback) => {
    log.warn(`[permission] deny display-media ${name}`);
    callback({});
  });
  ses.on("select-hid-device", (event, _details, callback) => {
    event.preventDefault();
    log.warn(`[permission] deny hid ${name}`);
    callback();
  });
  ses.on("select-serial-port", (event, _ports, _wc, callback) => {
    event.preventDefault();
    log.warn(`[permission] deny serial ${name}`);
    callback("");
  });
  ses.on("select-usb-device", (event, _details, callback) => {
    event.preventDefault();
    log.warn(`[permission] deny usb ${name}`);
    callback();
  });
  ses.on("will-download", (event, item) => {
    const url = item.getURL();
    if (downloadDecision({ partition: name, url, appOrigin: o.appOrigin() }) === "cancel") {
      event.preventDefault();
      log.warn(`[download] cancel ${name} ${describeUrl(url)}`);
      return;
    }
    const file = safeFileName(item.getFilename());
    if (o.savePath) item.setSavePath(o.savePath);
    else item.setSaveDialogOptions({ defaultPath: join(homedir(), "Downloads", file) });
    log.info(`[download] save ${describeUrl(url)}`);
  });
}

export function hardenWebContents(contents: WebContents, log: Log): void {
  contents.on("will-attach-webview", (event) => {
    event.preventDefault();
    log.warn("[nav] deny webview");
  });
  contents.on("will-frame-navigate", (details) => {
    if (details.isMainFrame) return;
    const parent = details.frame?.parent?.origin;
    if (subframeDecision(details.url, parent) === "cancel") {
      details.preventDefault();
      log.warn(`[nav] deny ${viewName(contents)} subframe ${describeUrl(details.url)}`);
    }
  });
  contents.on("select-bluetooth-device", (event, _devices, callback) => {
    event.preventDefault();
    log.warn("[permission] deny bluetooth");
    callback("");
  });
  contents.setWindowOpenHandler(() => ({ action: "deny" }));
}

const VIEW_NAMES = new WeakMap<WebContents, string>();
export const nameView = (contents: WebContents, view: string) => VIEW_NAMES.set(contents, view);
export const viewName = (contents: WebContents) => VIEW_NAMES.get(contents) ?? "other";
