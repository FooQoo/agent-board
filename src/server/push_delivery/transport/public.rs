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
        || a == 0
        || (a == 100 && (64..128).contains(&b))
        || (a == 192 && b == 0 && c == 0)
        || (a == 198 && (b == 18 || b == 19))
        || a >= 240)
}

fn public_v6(ip: Ipv6Addr) -> bool {
    let first = ip.segments()[0];
    !(ip.is_unspecified()
        || ip.is_loopback()
        || ip.is_multicast()
        || first & 0xfe00 == 0xfc00
        || first & 0xffc0 == 0xfe80
        || first == 0x2001 && ip.segments()[1] == 0x0db8
        || first == 0x0064 && ip.segments()[1] == 0xff9b)
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
