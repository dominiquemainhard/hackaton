'use strict';

const os = require('node:os');
const dgram = require('node:dgram');

/** 169.254.x.x = APIPA, what an interface gets when it never received a lease. */
const isLinkLocal = (ip) => ip.startsWith('169.254.');

const isPrivate = (ip) =>
  ip.startsWith('10.') || ip.startsWith('192.168.') || /^172\.(1[6-9]|2\d|3[01])\./.test(ip);

/** Address of the interface holding the default route, or null. */
let routedAddress = null;

/**
 * Every IPv4 address a phone could plausibly reach this machine on, best first.
 * Link-local addresses are dropped outright: a dangling USB dongle or a NIC
 * that never got a lease would otherwise win and the QR would point nowhere.
 */
function lanAddresses(interfaces) {
  const out = [];
  for (const [name, addrs] of Object.entries(interfaces || os.networkInterfaces())) {
    for (const a of addrs || []) {
      if (a.family === 'IPv4' && !a.internal && !isLinkLocal(a.address)) out.push({ name, address: a.address });
    }
  }
  return out.sort((a, b) => {
    if (a.address === routedAddress) return -1;
    if (b.address === routedAddress) return 1;
    return (isPrivate(b.address) ? 1 : 0) - (isPrivate(a.address) ? 1 : 0);
  });
}

/**
 * Resolves which local address the kernel would route through. Connecting a UDP
 * socket sends no packets, it only picks the route. Calls onChange(address)
 * when the answer differs from last time.
 */
function refreshRoutedAddress(onChange) {
  let sock;
  const finish = (addr) => {
    try { sock.close(); } catch { /* already closed */ }
    const valid = addr && addr !== '0.0.0.0' && !isLinkLocal(addr) ? addr : null;
    if (valid !== routedAddress) {
      routedAddress = valid;
      if (onChange) onChange(valid);
    }
  };
  try {
    sock = dgram.createSocket('udp4');
    sock.on('error', () => finish(null));
    sock.connect(53, '8.8.8.8', () => {
      let addr = null;
      try { addr = sock.address().address; } catch { /* ignore */ }
      finish(addr);
    });
  } catch {
    finish(null);
  }
}

const getRoutedAddress = () => routedAddress;
const setRoutedAddress = (a) => { routedAddress = a; }; // test seam

module.exports = { isLinkLocal, isPrivate, lanAddresses, refreshRoutedAddress, getRoutedAddress, setRoutedAddress };
