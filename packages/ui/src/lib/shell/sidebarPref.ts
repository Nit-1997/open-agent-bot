const KEY = "oa.sidebar";

export function readSidebarOpen(): boolean {
  try {
    return localStorage.getItem(KEY) !== "collapsed";
  } catch {
    return true;
  }
}

export function writeSidebarOpen(open: boolean): void {
  try {
    localStorage.setItem(KEY, open ? "open" : "collapsed");
  } catch {}
}
