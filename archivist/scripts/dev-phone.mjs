/**
 * Dev server reachable from the field-capture iPhone app:
 * binds Next.js to 0.0.0.0 and advertises it over Bonjour as _fieldscan._tcp
 * (the service the phone browses for; it reads ip/port from the TXT record).
 *
 * Env: PORT (default 3000), FIELD_CAPTURE_ADVERTISE_IP (override LAN ip),
 *      ARCHIVIST_BONJOUR=0 to skip advertising.
 *
 * --usb: advertise the USB cable's link-local address (169.254.x.x) instead of
 * Wi-Fi, for hotel/conference networks that block device-to-device traffic.
 * The iPhone must be plugged in; a host typed into the app overrides Bonjour.
 */
import { spawn } from "node:child_process";
import os from "node:os";

const port = process.env.PORT ?? "3000";

const usb = process.argv.includes("--usb");

function usbIp() {
  for (const [name, addrs] of Object.entries(os.networkInterfaces())) {
    const addr = addrs?.find((a) => a.family === "IPv4" && a.address.startsWith("169.254."));
    if (addr) return { name, address: addr.address };
  }
  return null;
}

function lanIp() {
  if (process.env.FIELD_CAPTURE_ADVERTISE_IP) return process.env.FIELD_CAPTURE_ADVERTISE_IP;
  if (usb) {
    const link = usbIp();
    if (!link) {
      console.error("[usb] no 169.254.x.x interface found. Plug in the iPhone (and trust this Mac), then retry.");
      process.exit(1);
    }
    console.log(`[usb] using ${link.name} ${link.address}`);
    return link.address;
  }
  const ifaces = os.networkInterfaces();
  const ordered = ["en0", "en1", ...Object.keys(ifaces)];
  for (const name of ordered) {
    const addr = ifaces[name]?.find((a) => a.family === "IPv4" && !a.internal);
    if (addr) return addr.address;
  }
  return "127.0.0.1";
}

const ip = lanIp();
const children = [spawn("npx", ["next", "dev", "-H", "0.0.0.0", "-p", port], { stdio: "inherit" })];
if (process.platform === "darwin" && process.env.ARCHIVIST_BONJOUR !== "0") {
  const name = `Archivist ${os.hostname().split(".")[0]}`;
  children.push(
    spawn("dns-sd", ["-R", name, "_fieldscan._tcp", "local", port, `ip=${ip}`, `port=${port}`], { stdio: "ignore" }),
  );
  console.log(`[bonjour] advertising "${name}" as _fieldscan._tcp at ${ip}:${port}`);
}
console.log(`[phone] in the app, long-press the page count and enter ${ip}:${port} if discovery fails`);

const stop = () => {
  for (const c of children) c.kill();
  process.exit(0);
};
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
children[0].on("exit", (code) => {
  for (const c of children.slice(1)) c.kill();
  process.exit(code ?? 0);
});
