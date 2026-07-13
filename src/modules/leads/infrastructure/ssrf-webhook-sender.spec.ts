import { isForbiddenAddress } from './ssrf-webhook-sender';

describe('isForbiddenAddress', () => {
  const forbidden = [
    '127.0.0.1', // loopback
    '10.0.0.1', // RFC1918
    '172.16.0.1', // RFC1918
    '192.168.1.1', // RFC1918
    '169.254.169.254', // link-local / cloud metadata
    '0.0.0.0', // unspecified
    '255.255.255.255', // broadcast
    '224.0.0.1', // multicast
    '100.64.0.1', // CGNAT
    '::1', // IPv6 loopback
    'fd00::1', // IPv6 ULA
    'fe80::1', // IPv6 link-local
    '::ffff:127.0.0.1', // IPv4-mapped loopback
    'not-an-ip', // unparseable → fail closed
  ];

  const allowed = ['8.8.8.8', '1.1.1.1', '93.184.216.34', '2606:2800:220:1:248:1893:25c8:1946'];

  it.each(forbidden)('treats %s as forbidden', (ip) => {
    expect(isForbiddenAddress(ip)).toBe(true);
  });

  it.each(allowed)('treats %s as allowed', (ip) => {
    expect(isForbiddenAddress(ip)).toBe(false);
  });
});
