import { execFile } from 'node:child_process';

/**
 * Wi-Fi status for the home screen, via NetworkManager's nmcli.
 * Resolves { kind: 'wifi', ssid, signal } | { kind: 'wired' } | { kind: 'offline' } | null (unknown).
 */
export function networkStatus() {
  return new Promise((resolve) => {
    execFile('nmcli', ['-t', '-f', 'TYPE,STATE,CONNECTION', 'device'], { timeout: 3000 }, (err, out) => {
      if (err) return resolve(null);
      const devices = out.trim().split('\n').map((l) => l.split(':'));
      const up = (type) => devices.find(([t, state]) => t === type && state === 'connected');
      const wifi = up('wifi');
      if (!wifi) return resolve(up('ethernet') ? { kind: 'wired' } : { kind: 'offline' });

      execFile('nmcli', ['-t', '-f', 'ACTIVE,SSID,SIGNAL', 'device', 'wifi', 'list', '--rescan', 'no'],
        { timeout: 3000 }, (err2, out2) => {
          // nmcli -t escapes ':' in values as '\:'.
          const active = !err2 && out2.split('\n').find((l) => l.startsWith('yes:'));
          if (!active) return resolve({ kind: 'wifi', ssid: wifi[2], signal: null });
          const fields = active.split(/(?<!\\):/).map((f) => f.replace(/\\:/g, ':'));
          resolve({ kind: 'wifi', ssid: fields[1] || wifi[2], signal: Number(fields[2]) || null });
        });
    });
  });
}
