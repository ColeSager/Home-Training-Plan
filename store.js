const KEY = "htp.v1";

const isObj = (v) => v !== null && typeof v === "object" && !Array.isArray(v);

export function emptyState() {
  return { schema: 1, logs: {}, overrides: {}, lastBackupAt: null };
}

export function parseState(text) {
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    return null;
  }
  if (!isObj(data) || data.schema !== 1 || !isObj(data.logs)) return null;
  if (data.overrides !== undefined && !isObj(data.overrides)) return null;
  return {
    schema: 1,
    logs: data.logs,
    overrides: data.overrides ?? {},
    lastBackupAt: data.lastBackupAt ?? null,
  };
}

export function loadState() {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return parseState(raw) ?? emptyState();
  } catch {}
  return emptyState();
}

export function saveState(state) {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
    return true;
  } catch {
    return false;
  }
}

export function storageWorks() {
  try {
    localStorage.setItem("htp.probe", "1");
    localStorage.removeItem("htp.probe");
    return true;
  } catch {
    return false;
  }
}
