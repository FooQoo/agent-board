//! Keeping the sender on the public internet.
//!
//! A subscription's endpoint is checked when it is stored (`endpoint_ok`), but a host name that
//! passes can still resolve to an address on the PC's own network. [`PublicOnly`] is the DNS
//! resolver of the real transport: it drops every address that is not a public one, so the
//! connection is made only to an address that was checked, and a host with none is refused.

use std::net::{IpAddr, Ipv4Addr, Ipv6Addr, SocketAddr};

use reqwest::dns::{Addrs, Name, Resolve, Resolving};

/// Whether an address belongs to the public internet: not this host, not a private, shared,
/// link-local, multicast, documentation or otherwise reserved range.
pub(super) fn is_public(ip: IpAddr) -> bool {
    match ip {
        IpAddr::V4(v4) => public_v4(v4),
        IpAddr::V6(v6) => match v6.to_ipv4_mapped() {
            Some(v4) => public_v4(v4),
            None => public_v6(v6),
        },
    }
}

fn public_v4(ip: Ipv4Addr) -> bool {
    let [a, b, c, _] = ip.octets();
    !(ip.is_unspecified()
        || ip.is_loopback()
        || ip.is_private()
        || ip.is_link_local()
        || ip.is_broadcast()
        || ip.is_multicast()
        || ip.is_documentation()
        // "This network" 0.0.0.0/8.
        || a == 0
        // Shared address space 100.64.0.0/10.
        || (a == 100 && (64..128).contains(&b))
        // IETF protocol assignments 192.0.0.0/24 and the 6to4 relay anycast 192.88.99.0/24.
        || (a == 192 && b == 0 && c == 0)
        || (a == 192 && b == 88 && c == 99)
        // Benchmarking 198.18.0.0/15.
        || (a == 198 && (b == 18 || b == 19))
        // Reserved 240.0.0.0/4.
        || a >= 240)
}

/// Only global unicast `2000::/3` can be public; of it, the ranges that are not routed to the
/// internet or that carry an IPv4 address (6to4, Teredo, NAT64) are refused.
fn public_v6(ip: Ipv6Addr) -> bool {
    let s = ip.segments();
    if s[0] & 0xe000 != 0x2000 {
        // Unspecified, loopback, IPv4-compatible, unique local, link-local, site-local,
        // multicast and every other range that is not global unicast.
        return false;
    }
    // 6to4 `2002::/16` names the IPv4 address it relays to.
    if s[0] == 0x2002 {
        let v4 = Ipv4Addr::new((s[1] >> 8) as u8, s[1] as u8, (s[2] >> 8) as u8, s[2] as u8);
        return public_v4(v4);
    }
    let ietf_protocol_assignments = s[0] == 0x2001 && s[1] < 0x0200;
    let documentation = (s[0] == 0x2001 && s[1] == 0x0db8) || (s[0] == 0x3fff && s[1] < 0x1000);
    // Segment routing SIDs `5f00::/16`.
    !(ietf_protocol_assignments || documentation || s[0] == 0x5f00)
}

/// Resolves a host name and keeps only its public addresses.
pub(super) struct PublicOnly;

impl Resolve for PublicOnly {
    fn resolve(&self, name: Name) -> Resolving {
        Box::pin(async move {
            let found = tokio::net::lookup_host((name.as_str(), 443)).await?;
            let public: Vec<SocketAddr> = found.filter(|a| is_public(a.ip())).collect();
            if public.is_empty() {
                return Err("the host has no public address".into());
            }
            Ok(Box::new(public.into_iter()) as Addrs)
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ip(text: &str) -> IpAddr {
        text.parse().unwrap()
    }

    #[test]
    fn only_public_addresses_pass() {
        for ok in [
            "8.8.8.8",
            "17.253.0.1",
            "142.250.80.46",
            "2607:f8b0:4004::200e",
            "2002:0808:0808::1",
            "2a00:1450:4001::1",
        ] {
            assert!(is_public(ip(ok)), "{ok}");
        }
        for bad in [
            "127.0.0.1",
            "10.0.0.5",
            "172.16.3.4",
            "192.168.1.10",
            "169.254.169.254",
            "100.64.0.1",
            "0.0.0.0",
            "224.0.0.1",
            "255.255.255.255",
            "198.18.0.1",
            "::1",
            "::",
            "fe80::1",
            "fd00::1",
            "ff02::1",
            "::ffff:127.0.0.1",
            "::ffff:10.1.2.3",
            "2001:db8::1",
            "fec0::1",
            "feff::1",
            "3fff::1",
            "64:ff9b::a00:1",
            "64:ff9b::808:808",
            "2001::1",
            "2001:0:4136:e378:8000:63bf:3fff:fdd2",
            "2002:a00:1::1",
            "2002:7f00:1::",
            "2002:c0a8:101::1",
            "::10.0.0.1",
            "100::1",
            "5f00::1",
            "0.0.0.1",
            "192.0.0.8",
            "192.88.99.1",
            "198.19.255.255",
            "240.0.0.1",
            "192.0.2.1",
            "198.51.100.1",
            "203.0.113.1",
            "::ffff:192.168.0.1",
        ] {
            assert!(!is_public(ip(bad)), "{bad}");
        }
    }

    #[tokio::test]
    async fn a_host_that_resolves_only_to_the_loopback_is_refused() {
        let found = PublicOnly.resolve("localhost".parse().unwrap()).await;
        assert!(found.is_err());
    }
}
